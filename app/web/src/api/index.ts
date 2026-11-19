// The API the app uses: the HTTP client, or the in-memory fixture client under VITE_FIXTURES=1.
import { httpClient, type ApiClient } from './client';

export { ApiRequestError, RequestAbandoned, type ApiClient } from './client';
export { errorDetail, errorKind, errorMessage, kindOf, type ErrorKind } from './errors';
export { loadIndex, loadScene, loadSong } from './content';

export const FIXTURES = import.meta.env.VITE_FIXTURES === '1';

// The fixture client (with the speech scorer, fixtures and catalogs it pulls in) is loaded only under
// VITE_FIXTURES=1, so none of it lands in the production entry chunk.
export const api: ApiClient = FIXTURES ? (await import('./fixtureClient')).fixtureClient : httpClient;
