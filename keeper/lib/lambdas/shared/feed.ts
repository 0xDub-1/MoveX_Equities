// =============================================================================
// Price feed decisions
// =============================================================================
//
// Pure, so the rule can be tested without a chain or a quote source.

/**
 * Whether a quote is worth writing to the feed.
 *
 * `update_price` demands a strictly newer publish time, so re-writing a
 * price the feed already holds is rejected. The crank bundles that write
 * with the `lock` or `settle` it serves, which means a rejected write takes
 * the whole transaction down with it.
 *
 * Three rungs of one ladder lock at the same instant against one shared
 * feed, and they all carry the same source timestamp. Without this check the
 * first rung writes the price and the other two fail on a guard that was
 * only ever meant to stop a stale replay, never a duplicate of the value
 * already there.
 *
 * Skipping the write is safe: the feed already carries exactly the price the
 * update would have written. It still has to be fresh enough for the
 * program, which is a separate check the program makes for itself.
 */
export function needsPriceUpdate(quotePublishTime: number, feedPublishTime: number): boolean {
  return quotePublishTime > feedPublishTime;
}
