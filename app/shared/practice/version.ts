// The version of the practice composer (practice.ts: composePractice), in a module of
// its own so the API client can send it without pulling the composer into the entry chunk.

/**
 * Sent with every POST /api/practices/start and stored by the server with each practice
 * (PracticePlan.composerVersion). A practice continued later is composed again from its stored seed
 * and resumed by count; the version says whether the composer that made it is the one composing it
 * now. Bump when the same input would give other puzzles.
 */
export const COMPOSER_VERSION = 3;
