import { needsPriceUpdate } from '../lib/lambdas/shared/feed';

describe('needsPriceUpdate', () => {
  it('writes a quote the feed has not seen', () => {
    expect(needsPriceUpdate(1_800_000_060, 1_800_000_000)).toBe(true);
  });

  /**
   * The bug this pins. Three rungs of one ladder lock at the same instant
   * against one shared feed, carrying the same source timestamp. The crank
   * bundles the price write with the lock, and `update_price` refuses a
   * publish time that is not strictly newer, so on 14 September 2026 the
   * first rung of each ticker locked and the other two were rejected along
   * with their own locks. Seven of nine daily markets never locked.
   */
  it('does not rewrite a quote the feed already carries', () => {
    expect(needsPriceUpdate(1_800_000_000, 1_800_000_000)).toBe(false);
  });

  it('does not roll the feed backwards', () => {
    expect(needsPriceUpdate(1_799_999_940, 1_800_000_000)).toBe(false);
  });

  /**
   * After the close a quote source stops moving: the last regular-session
   * print keeps its timestamp for the rest of the day. Every crank tick then
   * sees the same publish time, which is exactly when rewriting has to stop
   * rather than fail loudly once a minute.
   */
  it('stays quiet once the source stops moving', () => {
    const close = 1_800_000_000;
    for (let tick = 0; tick < 5; tick++) {
      expect(needsPriceUpdate(close, close)).toBe(false);
    }
  });

  it('treats an unwritten feed as needing anything', () => {
    expect(needsPriceUpdate(1, 0)).toBe(true);
  });
});
