import {
  RATE_LIMIT_ATTEMPTS,
  RATE_LIMIT_MAX_MS,
  RETRY_DELAY_MS,
  SEND_ATTEMPTS,
  isProgramVerdict,
  isRateLimited,
  retryDelayMs,
  shouldRetrySend,
} from '../lib/lambdas/shared/sending';

describe('isProgramVerdict', () => {
  /**
   * The bug this pins. On 18 September 2026 the TIGHT and FAIR rungs of
   * TSLA's 2026-09-22 ladder never reached the chain while WIDE, sent from
   * the same run against the same samples, did. The samples derived exactly
   * the strikes the program recomputes, so nothing was refused: two sends
   * were dropped, and with no retry the ladder shipped with one market of
   * three. The same thing cost SPY two rungs of its 2026-09-21 ladder.
   */
  it('treats a dropped send as worth retrying', () => {
    expect(isProgramVerdict(new Error('Blockhash not found'))).toBe(false);
    expect(isProgramVerdict(new Error('Transaction was not confirmed in 30.00 seconds'))).toBe(
      false,
    );
    expect(isProgramVerdict(new Error('429 Too Many Requests'))).toBe(false);
    expect(isProgramVerdict(new Error('fetch failed'))).toBe(false);
  });

  it('treats a refusal from the program as final', () => {
    expect(
      isProgramVerdict(new Error('failed to send transaction: custom program error: 0x1773')),
    ).toBe(true);
    expect(
      isProgramVerdict(new Error('AnchorError occurred. Error Code: StrikeNotDerivedFromSamples')),
    ).toBe(true);
    expect(isProgramVerdict(new Error('Error Code: LockTimeInPast. Error Number: 6013'))).toBe(
      true,
    );
  });

  /**
   * A second attempt on a market the first attempt actually landed hits this
   * rather than creating anything, because `init_market` allocates the PDA
   * and will not allocate it twice. Retrying past it buys nothing.
   */
  it('treats an account that already exists as final', () => {
    expect(isProgramVerdict(new Error('Allocate: account Address { .. } already in use'))).toBe(
      true,
    );
  });

  it('survives something that is not an Error at all', () => {
    expect(isProgramVerdict('socket hang up')).toBe(false);
    expect(isProgramVerdict(undefined)).toBe(false);
  });
});

describe('shouldRetrySend', () => {
  const dropped = new Error('Blockhash not found');
  const refused = new Error('custom program error: 0x1773');

  it('retries a dropped send until the cap', () => {
    for (let attempt = 1; attempt < SEND_ATTEMPTS; attempt++) {
      expect(shouldRetrySend(dropped, attempt)).toBe(true);
    }
  });

  /**
   * The cap is not politeness. A market lambda has nine of these to get
   * through before its timeout, and a rung that will never land must not
   * spend the window the other eight still need.
   */
  it('stops at the cap rather than spending the window', () => {
    expect(shouldRetrySend(dropped, SEND_ATTEMPTS)).toBe(false);
    expect(shouldRetrySend(dropped, SEND_ATTEMPTS + 1)).toBe(false);
  });

  it('never retries a refusal, even on the first attempt', () => {
    expect(shouldRetrySend(refused, 1)).toBe(false);
  });

  /**
   * The failure of 23 and 25 September 2026: three sends 1.2 seconds apart
   * all landed inside the same rate limited window and the rung was lost.
   * A 429 gets more attempts than a dropped send, because it goes away if
   * the sender waits.
   */
  it('gives a rate limited send more attempts than a dropped one', () => {
    const limited = new Error('429 Too Many Requests: {"code":-32429,"message":"rate limited"}');
    expect(RATE_LIMIT_ATTEMPTS).toBeGreaterThan(SEND_ATTEMPTS);
    for (let attempt = 1; attempt < RATE_LIMIT_ATTEMPTS; attempt++) {
      expect(shouldRetrySend(limited, attempt)).toBe(true);
    }
    expect(shouldRetrySend(limited, RATE_LIMIT_ATTEMPTS)).toBe(false);
  });
});

describe('isRateLimited', () => {
  it('recognises the ways an RPC says 429', () => {
    expect(
      isRateLimited(new Error('429 Too Many Requests: {"jsonrpc":"2.0","error":{"code":-32429}}')),
    ).toBe(true);
    expect(isRateLimited(new Error('Server responded with 429 Too Many Requests.'))).toBe(true);
    expect(isRateLimited('rate limited')).toBe(true);
  });

  it('does not mistake other failures, or numbers that merely contain 429', () => {
    expect(isRateLimited(new Error('Blockhash not found'))).toBe(false);
    expect(isRateLimited(new Error('custom program error: 0x1773'))).toBe(false);
    expect(isRateLimited(new Error('slot 4294967 skipped'))).toBe(false);
  });
});

describe('retryDelayMs', () => {
  const limited = new Error('429 Too Many Requests');
  const noJitter = () => 0;

  it('keeps the short wait for a dropped send', () => {
    expect(retryDelayMs(new Error('Blockhash not found'), 1, noJitter)).toBe(RETRY_DELAY_MS);
  });

  it('doubles the wait after each 429, up to the ceiling', () => {
    expect(retryDelayMs(limited, 1, noJitter)).toBe(2_000);
    expect(retryDelayMs(limited, 2, noJitter)).toBe(4_000);
    expect(retryDelayMs(limited, 3, noJitter)).toBe(8_000);
    expect(retryDelayMs(limited, 4, noJitter)).toBe(16_000);
    expect(retryDelayMs(limited, 9, noJitter)).toBe(RATE_LIMIT_MAX_MS);
  });

  it('adds under a second of jitter so limited lambdas do not return together', () => {
    const d = retryDelayMs(limited, 1, () => 0.999);
    expect(d).toBeGreaterThanOrEqual(2_000);
    expect(d).toBeLessThan(3_000);
  });
});
