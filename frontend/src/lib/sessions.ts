// =============================================================================
// Session arithmetic shared by both venues
// =============================================================================

export const HOUR_SECS = 3_600;
export const DAY_SECS = 86_400;

/** Whether a session id names an hourly market. Nine characters do; ten name a day. */
export function isHourlyId(sessionId: string): boolean {
  return sessionId.length !== 10;
}

/**
 * Whether the markets of an hourly group carry different thresholds.
 *
 * Equities hours share the day's threshold, read once the evening before.
 * Crypto hours are each calibrated when they are created, four hours ahead,
 * so a day's rows differ. The header says which, rather than assuming.
 */
export function strikesVary(strikes: readonly number[]): boolean {
  return new Set(strikes).size > 1;
}
