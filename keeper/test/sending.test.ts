import { SEND_ATTEMPTS, isProgramVerdict, shouldRetrySend } from '../lib/lambdas/shared/sending';

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
});
