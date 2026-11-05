import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createInitialState } from './library';

const OWNER_A = '00000000-0000-4000-8000-000000000001';
const OWNER_B = '00000000-0000-4000-8000-000000000002';
const state = createInitialState();
let db: PGlite;
async function asUser(id: string) {
  await db.exec('reset role; set role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
}
async function save(expected: number | null, owner = OWNER_A, payload: unknown = state) {
  return db.query<{ user_id: string; revision: number; state: unknown }>('select * from public.save_library_snapshot($1::jsonb, $2::bigint, $3::uuid)', [JSON.stringify(payload), expected, owner]);
}

describe('Supabase migration against a real PostgreSQL engine', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      insert into auth.users values ('${OWNER_A}'), ('${OWNER_B}');
    `);
    await db.exec(await readFile(new URL('../../supabase/migrations/202611050001_library_snapshots.sql', import.meta.url), 'utf8'));
  }, 30000);
  beforeEach(async () => { await db.exec('reset role; truncate public.library_snapshots;'); await asUser(OWNER_A); });
  afterAll(async () => { await db?.close(); });

  it('creates a private snapshot and increments its revision through CAS', async () => {
    const created = await save(null);
    expect(Number(created.rows[0].revision)).toBe(1);
    const updated = await save(1, OWNER_A, { ...state, volume: 42 });
    expect(Number(updated.rows[0].revision)).toBe(2);
    expect((updated.rows[0].state as { volume: number }).volume).toBe(42);
  });

  it('rejects stale revisions and a duplicate first upload without losing the saved data', async () => {
    await save(null); await save(1, OWNER_A, { ...state, volume: 42 });
    await expect(save(1, OWNER_A, { ...state, volume: 99 })).rejects.toMatchObject({ code: 'PT409' });
    await expect(save(null)).rejects.toMatchObject({ code: 'PT409' });
    const result = await db.query<{ state: { volume: number }; revision: number }>('select state, revision from public.library_snapshots');
    expect(result.rows[0].state.volume).toBe(42);
    expect(Number(result.rows[0].revision)).toBe(2);
  });

  it('prevents another authenticated user from reading, modifying or deleting the first user snapshot', async () => {
    await save(null); await asUser(OWNER_B);
    expect((await db.query('select * from public.library_snapshots')).rows).toHaveLength(0);
    expect((await db.query('update public.library_snapshots set revision = 99 where user_id = $1 returning *', [OWNER_A])).rows).toHaveLength(0);
    expect((await db.query('delete from public.library_snapshots where user_id = $1 returning *', [OWNER_A])).rows).toHaveLength(0);
    await expect(db.query('insert into public.library_snapshots(user_id,state) values ($1,$2::jsonb)', [OWNER_A, JSON.stringify(state)])).rejects.toMatchObject({ code: '42501' });
    await asUser(OWNER_A);
    expect((await db.query('select * from public.library_snapshots')).rows).toHaveLength(1);
  });

  it('prevents a stale client from writing into another newly signed-in account', async () => {
    await asUser(OWNER_B);
    await expect(save(null, OWNER_A)).rejects.toMatchObject({ code: '42501' });
    expect((await db.query('select * from public.library_snapshots')).rows).toHaveLength(0);
    expect((await save(null, OWNER_B)).rows[0].user_id).toBe(OWNER_B);
  });

  it('denies anonymous table access and RPC execution', async () => {
    await save(null); await db.exec('reset role; set role anon;');
    await expect(db.query('select * from public.library_snapshots')).rejects.toMatchObject({ code: '42501' });
    await expect(save(null)).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects missing schema fields even on a direct table write', async () => {
    await expect(save(null, OWNER_A, { version: 1, tracks: [] })).rejects.toMatchObject({ code: '22023' });
    await expect(db.query('insert into public.library_snapshots(user_id,state) values ($1,$2::jsonb)', [OWNER_A, JSON.stringify({ version: 1 })])).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects oversized documents and more than 200 playlists', async () => {
    await expect(save(null, OWNER_A, { ...state, extra: 'x'.repeat(5_000_001) })).rejects.toMatchObject({ code: '22023' });
    await expect(save(null, OWNER_A, { ...state, playlists: Array(201).fill({}) })).rejects.toMatchObject({ code: '22023' });
  });
});
