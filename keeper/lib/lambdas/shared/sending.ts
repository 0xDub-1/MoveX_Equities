// =============================================================================
// Send retry policy
// =============================================================================
//
// When a transaction is worth sending again, and when sending it again only
// spends a window the other markets still need.
//
// Kept apart from the code that sends so it can be tested without a chain,
// for the same reason `needsPriceUpdate` lives on its own: the decision is
// where the bugs are, and the plumbing around it is not.

/**
 * How many times one instruction is sent before it is given up on.
 *
 * Three, because the failures worth surviving here are single dropped sends,
 * and a market lambda has nine of these to get through inside its timeout.
 */
export const SEND_ATTEMPTS = 3;

/** Long enough for a fresh blockhash, short enough to fit nine markets. */
export const RETRY_DELAY_MS = 1_200;

/**
 * Whether the program refused this instruction, as opposed to the network
 * dropping it on the way.
 *
 * A refusal is a verdict: the same instruction sent again earns the same
 * answer. Anything else is the network, and the network is worth asking
 * twice.
 */
export function isProgramVerdict(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /custom program error|AnchorError|Error Code: |already in use/i.test(msg);
}

/**
 * How many times a send the RPC rate limited is tried before it is given up
 * on. More than a dropped send gets, because a 429 is a window that closes by
 * itself if the sender waits, not a transaction that went missing.
 */
export const RATE_LIMIT_ATTEMPTS = 5;

/** The first wait after a 429, doubled on every attempt after it. */
export const RATE_LIMIT_BASE_MS = 2_000;

/** No single wait longer than this, so one rung cannot spend the whole run. */
export const RATE_LIMIT_MAX_MS = 16_000;

/**
 * A pause between two market creations in the same run.
 *
 * On 23 and 25 September 2026 the daily run lost two and then three rungs to
 * `429 Too Many Requests`: nine creations back to back, each with its own
 * existence checks, on the same devnet key the every-minute lambdas share.
 */
export const PACE_MS = 500;

/** Whether the RPC turned the request away for sending too many. */
export function isRateLimited(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b|too many requests|rate limit/i.test(msg);
}

/** The whole policy: try again, or record the failure and move on. */
export function shouldRetrySend(err: unknown, attempt: number): boolean {
  if (isProgramVerdict(err)) return false;
  return attempt < (isRateLimited(err) ? RATE_LIMIT_ATTEMPTS : SEND_ATTEMPTS);
}

/**
 * How long to wait before attempt `attempt + 1`.
 *
 * A dropped send only needs a fresh blockhash. A rate limit needs the window
 * to pass, so the wait doubles from two seconds up to sixteen, plus up to a
 * second of jitter so two lambdas that were limited together do not come back
 * together.
 */
export function retryDelayMs(err: unknown, attempt: number, random: () => number = Math.random): number {
  if (!isRateLimited(err)) return RETRY_DELAY_MS;
  const backoff = Math.min(RATE_LIMIT_BASE_MS * 2 ** (attempt - 1), RATE_LIMIT_MAX_MS);
  return backoff + Math.floor(random() * 1_000);
}
