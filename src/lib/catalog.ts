import type { Playlist, Track } from './types';

// Video identifiers point to public YouTube uploads. Availability, ads and
// embedding permission are controlled by YouTube and the rights holders.
export const SEED_TRACKS: Track[] = [
  { id: '4NRXx6U8ABQ', title: 'Blinding Lights', artist: 'The Weeknd', duration: '4:23' },
  { id: 'kJQP7kiw5Fk', title: 'Despacito', artist: 'Luis Fonsi · Daddy Yankee', duration: '4:42' },
  { id: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody', artist: 'Queen', duration: '6:00' },
  { id: 'RgKAFK5djSk', title: 'See You Again', artist: 'Wiz Khalifa · Charlie Puth', duration: '3:58' },
  { id: 'hT_nvWreIhg', title: 'Counting Stars', artist: 'OneRepublic', duration: '4:44' },
  { id: 'OPf0YbXqDm0', title: 'Uptown Funk', artist: 'Mark Ronson · Bruno Mars', duration: '4:30' },
  { id: 'pRpeEdMmmQ0', title: 'Waka Waka (This Time for Africa)', artist: 'Shakira', duration: '3:31' },
  { id: 'CevxZvSJLk8', title: 'Roar', artist: 'Katy Perry', duration: '4:30' },
  { id: 'YqeW9_5kURI', title: 'Lean On', artist: 'Major Lazer · DJ Snake · MØ', duration: '2:59' },
  { id: '60ItHLz5WEA', title: 'Faded', artist: 'Alan Walker', duration: '3:32' },
  { id: '09R8_2nJtjg', title: 'Sugar', artist: 'Maroon 5', duration: '5:02' },
  { id: 'JGwWNGJdvx8', title: 'Shape of You', artist: 'Ed Sheeran', duration: '4:24' },
].map((track) => ({ ...track, thumbnail: `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg` }));

export const SEED_PLAYLISTS: Playlist[] = [
  { id: 'thrum-afterhours', name: 'After Hours', trackIds: ['4NRXx6U8ABQ', '60ItHLz5WEA', 'RgKAFK5djSk', 'YqeW9_5kURI'], createdAt: 0 },
  { id: 'thrum-goodenergy', name: 'Good Energy', trackIds: ['OPf0YbXqDm0', 'pRpeEdMmmQ0', 'CevxZvSJLk8', '09R8_2nJtjg'], createdAt: 0 },
  { id: 'thrum-classics', name: 'Les incontournables', trackIds: ['fJ9rUzIMcZQ', 'hT_nvWreIhg', 'kJQP7kiw5Fk', 'JGwWNGJdvx8'], createdAt: 0 },
];
