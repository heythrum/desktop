// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {activeLyricIndex, getSavedLyrics, LYRICS_STORAGE_KEY, MAX_LRC_BYTES, parseLrc, saveLyrics, type SavedLyrics} from './lyrics';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('LRC parsing', () => {
  it('parses fractional seconds, multiple timestamps and sorts chronologically', () => {
    expect(parseLrc('[ar:Artist]\n[ti:Title]\n[01:02.500][00:05.25]Same line\n[00:01]First\n[00:08.1]Last'))
      .toEqual([{time:1,text:'First'},{time:5.25,text:'Same line'},{time:8.1,text:'Last'},{time:62.5,text:'Same line'}]);
  });
  it('applies the LRC offset and clamps advanced lines at zero', () => {
    expect(parseLrc('[offset:+1500]\n[00:01]One\n[00:03]Three')).toEqual([{time:0,text:'One'},{time:1.5,text:'Three'}]);
    expect(parseLrc('[offset:-500]\n[00:01.00]One')[0].time).toBe(1.5);
  });
  it('ignores empty lines and metadata, but rejects text without valid time markers', () => {
    expect(parseLrc('[al:Album]\r\n[00:00]\r\n[00:05]Words')).toEqual([{time:5,text:'Words'}]);
    expect(() => parseLrc('[ar:Artist]\nplain text')).toThrow('Aucune parole');
    expect(() => parseLrc('[01:60]Invalid')).toThrow('Aucune parole');
  });
  it('rejects excessive file sizes, timestamps and line counts', () => {
    expect(() => parseLrc('a'.repeat(MAX_LRC_BYTES + 1))).toThrow('1 Mo');
    expect(() => parseLrc('[1441:00]Too late')).toThrow('24 heures');
    expect(() => parseLrc(Array.from({length:5001}, () => '[00:01]A').join('\n'))).toThrow('5 000');
  });
  it('never interprets HTML as markup', () => {
    expect(parseLrc('[00:01]<script>alert(1)</script>')[0].text).toBe('<script>alert(1)</script>');
  });
});

describe('local lyric persistence', () => {
  const value: SavedLyrics = {lines:[{time:2,text:'Hello'}],offsetSeconds:.5,filename:'song.lrc'};
  it('round trips lyrics per track and removes only the selected track', () => {
    saveLyrics('dQw4w9WgXcQ', value); saveLyrics('jfKfPfyJRdk', value);
    expect(getSavedLyrics('dQw4w9WgXcQ')).toEqual(value);
    saveLyrics('dQw4w9WgXcQ', null);
    expect(getSavedLyrics('dQw4w9WgXcQ')).toBeNull();
    expect(getSavedLyrics('jfKfPfyJRdk')).toEqual(value);
  });
  it('tolerates corrupt storage and ignores malformed saved lyrics', () => {
    localStorage.setItem(LYRICS_STORAGE_KEY, 'broken');
    expect(getSavedLyrics('song')).toBeNull();
    localStorage.setItem(LYRICS_STORAGE_KEY, JSON.stringify({version:1,tracks:{song:{...value, offsetSeconds:999}}}));
    expect(getSavedLyrics('song')).toBeNull();
    expect(getSavedLyrics('constructor')).toBeNull();
  });
  it('rejects invalid ids, unsorted timestamps, excessive offsets and nonfinite values', () => {
    expect(() => saveLyrics('../bad',value)).toThrow('Identifiant');
    expect(() => saveLyrics('song',{...value,offsetSeconds:31})).toThrow('invalides');
    expect(() => saveLyrics('song',{...value,lines:[{time:NaN,text:'No'}]})).toThrow('invalides');
    expect(() => saveLyrics('song',{...value,lines:[{time:8,text:'A'},{time:2,text:'B'}]})).toThrow('invalides');
  });
  it('reports storage quota failures instead of claiming the lyrics were saved', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {throw new DOMException('Full', 'QuotaExceededError');});
    expect(() => saveLyrics('song',value)).toThrow('stockage local');
  });
});

describe('playback synchronisation', () => {
  const lines = [{time:2,text:'One'},{time:5,text:'Two'},{time:9,text:'Three'}];
  it('finds the active line when playing or seeking backwards', () => {
    expect(activeLyricIndex(lines,1)).toBe(-1);
    expect(activeLyricIndex(lines,5)).toBe(1);
    expect(activeLyricIndex(lines,12)).toBe(2);
    expect(activeLyricIndex(lines,3)).toBe(0);
  });
  it('honours user delay and advance adjustments', () => {
    expect(activeLyricIndex(lines,5,1)).toBe(0);
    expect(activeLyricIndex(lines,4,-1)).toBe(1);
  });
});
