import { createSearchResponse, type SearchEvent } from '../../server/search';

export function handler(event: SearchEvent) { return createSearchResponse(event, process.env.YOUTUBE_API_KEY); }
