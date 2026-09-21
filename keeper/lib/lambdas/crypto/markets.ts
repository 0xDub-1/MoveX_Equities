// =============================================================================
// Markets, crypto: create, seed, claim
// =============================================================================
//
// Every ten minutes, around the clock:
//
//   1. make sure every hourly market inside the lead exists, calibrating a
//      fresh ladder from the last twenty closed hours whenever one is missing
//   2. make sure the daily ladder locking at the next midnight UTC exists,
//      calibrated on the last twenty closed days
//   3. fund both sides of every open crypto market from the crypto seed
//      wallets, rescue a live one with an empty side, claim what settled
//
// One lambda rather than three because the three steps want the same cadence
// and the same order: what step one creates, step three funds on the same
// tick. Ten minutes rather than an hour so a dropped send is repaired ten
// minutes later instead of leaving an hour without a market. A tick where
// nothing is missing costs a handful of account reads and no candle request.

import { Logger } from "@aws-lambda-powertools/logger";
import { PublicKey } from "@solana/web3.js";

import { CRYPTO_ASSETS, CRYPTO_HOURLY_TIER, coinOf } from "../shared/crypto-config";
import { cryptoLadder, type Ladder } from "../shared/hyperliquid";
import { ensureMarkets, type MarketSpec } from "../shared/markets";
import { runSeeder } from "../shared/seed-run";
import { seedWalletIndices } from "../shared/seeding";
import { getProgram, marketPda } from "../shared/solana";
import {
  cryptoCandidates,
  dailySlotsAhead,
  dailySpec,
  hourlySlotsAhead,
  hourlySpec,
  type UtcSlot,
} from "../shared/utc-sessions";

const logger = new Logger({ serviceName: "movex-crypto-markets" });

function quoteMint(): PublicKey {
  const value = process.env.QUOTE_MINT;
  if (!value) throw new Error("QUOTE_MINT is not set");
  return new PublicKey(value);
}

function treasury(fallback: PublicKey): PublicKey {
  return process.env.TREASURY ? new PublicKey(process.env.TREASURY) : fallback;
}

export interface CryptoMarketsResult {
  created: string[];
  existing: string[];
  failed: string[];
  deposited: string[];
  claimed: string[];
}

/**
 * The specs that should exist and do not, with a ladder fetched only for a
 * symbol that actually needs one. The existence check is a handful of reads;
 * the candle request is the thing worth not making every ten minutes.
 */
export async function missingSpecs(nowSec: number): Promise<MarketSpec[]> {
  const program = await getProgram();
  const connection = program.provider.connection;
  const specs: MarketSpec[] = [];

  for (const asset of CRYPTO_ASSETS) {
    const symbol = asset.symbol;

    // -- hourly ------------------------------------------------------------
    if (asset.hourly) {
      const slots = hourlySlotsAhead(nowSec);
      const missing = await absent(
        connection,
        slots.map((slot) => ({ slot, tier: CRYPTO_HOURLY_TIER })),
        symbol,
      );
      if (missing.length > 0) {
        const ladder = await ladderOrNull(symbol, "1h");
        if (ladder && ladder.strikeBps >= 1) {
          for (const { slot } of missing) specs.push(hourlySpec(symbol, slot, ladder));
        } else if (ladder) {
          // The program rejects a zero strike anyway; say why here.
          logger.error("hourly ladder produced a zero strike, skipping", { symbol });
        }
      }
    }

    // -- daily -------------------------------------------------------------
    if (asset.dailyRungs.length > 0) {
      const slots = dailySlotsAhead(nowSec);
      const wanted = slots.flatMap((slot) => asset.dailyRungs.map((tier) => ({ slot, tier })));
      const missing = await absent(connection, wanted, symbol);
      if (missing.length > 0) {
        const ladder = await ladderOrNull(symbol, "1d");
        if (ladder) {
          for (const { slot, tier } of missing) specs.push(dailySpec(symbol, slot, tier, ladder));
        }
      }
    }
  }

  return specs;
}

async function absent<T extends { slot: UtcSlot; tier: "tight" | "fair" | "wide" }>(
  connection: { getMultipleAccountsInfo(keys: PublicKey[]): Promise<(unknown | null)[]> },
  wanted: T[],
  symbol: string,
): Promise<T[]> {
  if (wanted.length === 0) return [];
  const program = await getProgram();
  const keys = wanted.map((w) => marketPda(program.programId, symbol, w.slot.sessionId, w.tier));
  const infos = await connection.getMultipleAccountsInfo(keys);
  return wanted.filter((_, i) => !infos[i]);
}

/** One asset without a ladder must not cost the others their markets. */
async function ladderOrNull(symbol: string, interval: "1h" | "1d"): Promise<Ladder | null> {
  try {
    const ladder = await cryptoLadder(coinOf(symbol), interval);
    logger.info("ladder", { symbol, interval, strikes: ladder.strikes });
    return ladder;
  } catch (err) {
    logger.error("no ladder, skipping symbol", {
      symbol,
      interval,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export const handler = async (): Promise<CryptoMarketsResult> => {
  const nowSec = Math.floor(Date.now() / 1000);
  const program = await getProgram();

  const specs = await missingSpecs(nowSec);
  let creation = { created: [] as string[], existing: [] as string[], failed: [] as string[] };
  if (specs.length > 0) {
    logger.info("creating", { count: specs.length, labels: specs.map((s) => `${s.symbol}/${s.sessionId}/${s.tier}`) });
    creation = await ensureMarkets(program, quoteMint(), treasury(program.provider.publicKey!), specs);
    logger.info("creation result", creation);
  }

  const seeding = await runSeeder({
    specs: cryptoCandidates(nowSec),
    walletIndices: seedWalletIndices("crypto"),
    logger,
  });

  return { ...creation, ...seeding };
};
