// =============================================================================
// Price history provider
// =============================================================================
//
// The keeper needs 20 completed daily closes to calibrate a strike ladder.
// That is the entire surface. Settlement prices come from Pyth on-chain and
// never pass through here.
//
// This boundary exists because the selected provider (Yahoo's chart API) is
// unofficial and can change without notice. Swapping it must stay a one-file
// change, so nothing above this interface may know where bars come from.

/** One completed trading session. */
export interface DailyBar {
  /** Session date as `YYYY-MM-DD`, in US Eastern. */
  readonly date: string;
  /** Official closing price for that session. */
  readonly close: number;
}

export interface HistoryRequest {
  readonly ticker: string;
  /**
   * Minimum number of completed sessions required. Providers should return
   * more when it is free to do so; the caller trims to the window it wants.
   */
  readonly minSessions: number;
  /**
   * Exclusive upper bound, `YYYY-MM-DD` in US Eastern. Bars dated on or
   * after this are dropped.
   *
   * This is load-bearing. The keeper runs at 15:55 ET, while the session is
   * still open, and data vendors happily return today's in-progress bar with
   * a "close" that is really just the last print. Including it would
   * calibrate tomorrow's threshold against a price that never existed as a
   * close.
   */
  readonly before: string;
}

export interface PriceHistoryProvider {
  /** Short identifier, recorded in the report for provenance. */
  readonly name: string;

  /**
   * Completed daily closes for a ticker, oldest first, strictly before
   * `before`. Throws if the provider is unreachable, rejects the symbol, or
   * cannot supply `minSessions` bars.
   */
  dailyCloses(req: HistoryRequest): Promise<DailyBar[]>;
}
