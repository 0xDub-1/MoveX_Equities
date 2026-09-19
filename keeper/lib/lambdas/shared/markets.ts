// =============================================================================
// Market creation
// =============================================================================
//
// Both market lambdas do the same thing with different clocks: work out which
// markets should exist, check which already do, and create the difference.
//
// Idempotent by construction. Every run asks the chain what is missing rather
// than remembering what it did, so a missed invocation is repaired by the
// next one and a double invocation is a no-op.

import { Logger } from "@aws-lambda-powertools/logger";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Program } from "@coral-xyz/anchor";

import { easternTimestamp, hourlySlots, closeMinutes } from "./calendar";
import { FEE_BPS } from "./config";
import { RETRY_DELAY_MS, shouldRetrySend } from "./sending";
import { bn, marketPda, priceFeedPda, sessionBytes, underlyingBytes, vaultPda, TIER_VARIANT } from "./solana";

const logger = new Logger({ serviceName: "movex-equities-markets" });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Tier = "tight" | "fair" | "wide";

export interface MarketSpec {
  symbol: string;
  /** Ten bytes or fewer. `2026-09-16` daily, `0916-1000` hourly. */
  sessionId: string;
  tier: Tier;
  strikeBps: number;
  samplesBps: number[];
  lockTs: number;
  settleTs: number;
  /** Only for logging: what kind of instrument this is. */
  kind: "daily" | "hourly";
}

/**
 * Creates any of `specs` that do not already exist.
 *
 * Existence is checked per market rather than assumed from a previous run,
 * and each creation is isolated: one market failing must not cost the others,
 * because a day with five of six markets is far better than a day with none.
 */
export async function ensureMarkets(
  program: Program,
  quoteMint: PublicKey,
  treasury: PublicKey,
  specs: MarketSpec[],
): Promise<{ created: string[]; existing: string[]; failed: string[] }> {
  const created: string[] = [];
  const existing: string[] = [];
  const failed: string[] = [];

  for (const spec of specs) {
    const label = `${spec.symbol}/${spec.sessionId}/${spec.tier}`;
    try {
      const market = marketPda(program.programId, spec.symbol, spec.sessionId, spec.tier);

      if (await program.provider.connection.getAccountInfo(market)) {
        existing.push(label);
        continue;
      }

      if (spec.samplesBps.length !== 20) {
        throw new Error(`expected 20 samples, got ${spec.samplesBps.length}`);
      }

      const send = () =>
        program.methods
          .initMarket({
            underlying: Array.from(underlyingBytes(spec.symbol)),
            sessionDate: Array.from(sessionBytes(spec.sessionId)),
            tier: TIER_VARIANT[spec.tier],
            strikeBps: spec.strikeBps,
            samplesBps: spec.samplesBps,
            feeBps: FEE_BPS,
            treasury,
            // i64 in the IDL, so BN rather than a native number.
            lockTs: bn(spec.lockTs),
            settleTs: bn(spec.settleTs),
          })
          .accounts({
            authority: program.provider.publicKey!,
            market,
            quoteMint,
            vault: vaultPda(program.programId, market),
            // The program stores this and pins lock/settle to it. For the
            // devnet build that is our own keeper feed.
            pythFeed: priceFeedPda(program.programId, spec.symbol),
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

      for (let attempt = 1; ; attempt++) {
        try {
          await send();
          break;
        } catch (err) {
          // A send whose confirmation timed out may still have landed, and
          // the chain is the only honest answer to that.
          if (await program.provider.connection.getAccountInfo(market)) {
            logger.warn("market landed despite a failed send", { label, attempt });
            break;
          }
          if (!shouldRetrySend(err, attempt)) throw err;
          logger.warn("send failed, retrying", {
            label,
            attempt,
            error: err instanceof Error ? err.message.split("\n")[0] : String(err),
          });
          await sleep(RETRY_DELAY_MS);
        }
      }

      logger.info("created market", {
        label,
        kind: spec.kind,
        strikeBps: spec.strikeBps,
        lockTs: spec.lockTs,
        settleTs: spec.settleTs,
        address: market.toBase58(),
      });
      created.push(label);
    } catch (err) {
      logger.error("failed to create market", {
        label,
        error: err instanceof Error ? err.message : String(err),
      });
      failed.push(label);
    }
  }

  return { created, existing, failed };
}

/**
 * The hourly markets a session should carry.
 *
 * Whole hours from 10:00, with the leftover half hour taken off the open
 * rather than the close, so the last one settles exactly at the bell. On a
 * half day `hourlySlots` returns three instead of six, because the rest would
 * settle against a feed that stopped publishing at 13:00.
 */
export function hourlySpecs(
  date: string,
  symbol: string,
  strikeBps: number,
  samplesBps: number[],
): MarketSpec[] {
  return hourlySlots(date).map((slot) => ({
    symbol,
    sessionId: slot.sessionId,
    tier: "fair" as Tier,
    strikeBps,
    samplesBps,
    lockTs: easternTimestamp(date, slot.lockMinutes),
    settleTs: easternTimestamp(date, slot.settleMinutes),
    kind: "hourly" as const,
  }));
}

/**
 * A daily market measuring `settleDate`'s close-to-close move.
 *
 * It locks at the close of the previous session and settles at the close of
 * `settleDate`, so the overnight gap falls inside the measurement. That is
 * the whole reason the product measures close to close rather than within the
 * session: an intraday market records a flat day when a stock gaps 8% at the
 * open on earnings.
 */
export function dailySpec(
  lockDate: string,
  settleDate: string,
  symbol: string,
  tier: Tier,
  strikeBps: number,
  samplesBps: number[],
): MarketSpec {
  return {
    symbol,
    sessionId: settleDate,
    tier,
    strikeBps,
    samplesBps,
    lockTs: easternTimestamp(lockDate, closeMinutes(lockDate)),
    settleTs: easternTimestamp(settleDate, closeMinutes(settleDate)),
    kind: "daily",
  };
}
