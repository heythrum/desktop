export interface Track {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: string;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

export interface LibraryState {
  version: 1;
  tracks: Track[];
  favorites: string[];
  playlists: Playlist[];
  recent: string[];
  queue: string[];
  currentTrackId: string | null;
  volume: number;
  repeat: 'off' | 'all' | 'one';
  shuffle: boolean;
}
