import type {
  DailyBar,
  HistoryRequest,
  PriceHistoryProvider,
} from '../lib/lambdas/strikes/providers/types';
import { buildStrikeReport } from '../lib/lambdas/strikes/report';

/** The published NVDA move series, used here as the desired output. */
const NVDA_MOVES = [
  0.03, 0.06, 0.07, 0.33, 0.84, 0.91, 0.98, 0.99, 1.48, 1.51,
  1.59, 1.8, 2.01, 2.19, 2.34, 2.37, 2.91, 3.21, 4.57, 8.74,
];

/**
 * Builds the closes that produce a given move series, so a test can state
 * the moves it wants and let the fixture work backwards to prices.
 */
function barsProducing(moves: number[], cutoff: string): DailyBar[] {
  const dates = weekdaysEndingBefore(cutoff, moves.length + 1);
  const bars: DailyBar[] = [{ date: dates[0], close: 100 }];

  moves.forEach((pct, i) => {
    const prev = bars[i].close;
    bars.push({ date: dates[i + 1], close: prev * (1 + pct / 100) });
  });

  return bars;
}

function weekdaysEndingBefore(cutoff: string, count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${cutoff}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - 1);

  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.unshift(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return dates;
}

class FakeProvider implements PriceHistoryProvider {
  readonly name = 'fake';
  readonly requests: HistoryRequest[] = [];

  constructor(private readonly bars: Record<string, DailyBar[] | Error>) {}

  async dailyCloses(req: HistoryRequest): Promise<DailyBar[]> {
    this.requests.push(req);
    const entry = this.bars[req.ticker];
    if (entry === undefined) throw new Error(`no fixture for ${req.ticker}`);
    if (entry instanceof Error) throw entry;
    return entry;
  }
}

const SESSION = '2026-09-14';
const NOW = new Date('2026-09-14T19:55:00Z');

describe('buildStrikeReport', () => {
  it('calibrates the published ladder end to end', async () => {
    const provider = new FakeProvider({
      NVDA: barsProducing(NVDA_MOVES, SESSION),
    });

    const report = await buildStrikeReport({
      provider,
      tickers: [{ symbol: 'NVDA', rungs: ['tight', 'fair', 'wide'] }],
      asOf: SESSION,
      now: NOW,
    });

    expect(report.tickers.NVDA.strikes).toEqual({
      tight: 0.89,
      fair: 1.55,
      wide: 2.35,
    });
    expect(report.tickers.NVDA.strikesBps).toEqual({
      tight: 89,
      fair: 155,
      wide: 235,
    });
  });

  it('asks the provider to exclude the in-progress session', async () => {
    const provider = new FakeProvider({ NVDA: barsProducing(NVDA_MOVES, SESSION) });

    await buildStrikeReport({
      provider,
      tickers: [{ symbol: 'NVDA', rungs: ['fair'] }],
      asOf: SESSION,
      now: NOW,
    });

    expect(provider.requests[0]).toMatchObject({
      ticker: 'NVDA',
      before: SESSION,
      minSessions: 20,
    });
  });

  it('ships the sorted series as a first-class field for the UI', async () => {
    const provider = new FakeProvider({ NVDA: barsProducing(NVDA_MOVES, SESSION) });

    const report = await buildStrikeReport({
      provider,
      tickers: [{ symbol: 'NVDA', rungs: ['fair'] }],
      asOf: SESSION,
      now: NOW,
    });

    const { samples, sessions, window } = report.tickers.NVDA;
    expect(samples).toEqual(NVDA_MOVES);
    expect(sessions).toHaveLength(20);
    expect(window.count).toBe(20);
    expect(window.from).toBe(sessions[0].date);
    expect(window.to).toBe(sessions[19].date);
  });

  it('records provenance so a settled threshold can be traced back', async () => {
    const provider = new FakeProvider({ NVDA: barsProducing(NVDA_MOVES, SESSION) });

    const report = await buildStrikeReport({
      provider,
      tickers: [{ symbol: 'NVDA', rungs: ['fair'] }],
      asOf: SESSION,
      now: NOW,
    });

    expect(report).toMatchObject({
      session: SESSION,
      provider: 'fake',
      lookback: 20,
      generatedAt: NOW.toISOString(),
    });
    expect(report.errors).toBeUndefined();
  });

  it('lets a healthy ticker through when another one fails', async () => {
    const provider = new FakeProvider({
      NVDA: barsProducing(NVDA_MOVES, SESSION),
      TSLA: new Error('Yahoo returned HTTP 429'),
    });

    const report = await buildStrikeReport({
      provider,
      tickers: [
        { symbol: 'NVDA', rungs: ['fair'] },
        { symbol: 'TSLA', rungs: ['fair'] },
      ],
      asOf: SESSION,
      now: NOW,
    });

    expect(Object.keys(report.tickers)).toEqual(['NVDA']);
    expect(report.errors).toEqual({ TSLA: 'Yahoo returned HTTP 429' });
  });

  it('fails the invocation when every ticker fails', async () => {
    const provider = new FakeProvider({ TSLA: new Error('boom') });

    await expect(
      buildStrikeReport({
        provider,
        tickers: [{ symbol: 'TSLA', rungs: ['fair'] }],
        asOf: SESSION,
        now: NOW,
      }),
    ).rejects.toThrow(/failed for every ticker/);
  });

  it('refuses a short window rather than calibrating on partial history', async () => {
    const provider = new FakeProvider({
      NVDA: barsProducing(NVDA_MOVES.slice(0, 5), SESSION),
    });

    await expect(
      buildStrikeReport({
        provider,
        tickers: [{ symbol: 'NVDA', rungs: ['fair'] }],
        asOf: SESSION,
        now: NOW,
      }),
    ).rejects.toThrow(/every ticker/);
  });
});
