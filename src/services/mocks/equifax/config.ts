/**
 * Tunables for the EquifaxMock side effect. See ADR-0005.
 *
 * HARD_INQUIRY_PENALTY is intentionally higher than real-world Equifax
 * (~5-10) — at 30 points, a single pull is visible on screen during a
 * live demo and saga compensations have a clear visual restoration.
 * Flip to 10 when a prospect questions the realism — no other code change.
 */
export const HARD_INQUIRY_PENALTY = 30;
export const SCORE_FLOOR = 300;
