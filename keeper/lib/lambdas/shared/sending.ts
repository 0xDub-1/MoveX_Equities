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

/** The whole policy: try again, or record the failure and move on. */
export function shouldRetrySend(err: unknown, attempt: number): boolean {
  if (attempt >= SEND_ATTEMPTS) return false;
  return !isProgramVerdict(err);
}
