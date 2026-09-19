// =============================================================================
// Seeder
// =============================================================================
//
// Devnet only. Keeps every open market funded on both sides and claims what
// the seed wallets have won, so markets resolve instead of voiding and every
// instruction in the lifecycle runs against the chain each day.
//
// Six wallets derived from the publisher key, each spending its daily
// faucet allowance across the day's markets. Side and amount are random on
// each first deposit, with one rule: an empty side is always filled first,
// so no market is left one-sided by the draw.
//
// Idempotent per wallet, market and side. A wallet that already holds a
// position on a market is skipped, so a retried run never deposits twice
// and real deposits are never displaced.
//
// Transaction fees are paid by the publisher, which is the provider wallet.
// The seed wallets need SOL only for rent on their own accounts, which this
// funds from the publisher once and tops up when low.

import { Logger } from "@aws-lambda-powertools/logger";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { CalendarCoverageError, easternDate, isTradingDay } from "../shared/calendar";
import { candidates } from "../shared/candidates";
import { LIVE_CUTOFF_SECS } from "../shared/config";
import {
  DEPOSITORS_PER_MARKET,
  FAUCET_COOLDOWN_SECS,
  SEED_WALLET_COUNT,
  SOL_REFILL_BELOW,
  SOL_TARGET,
  chooseSide,
  depositAmount,
  seedBytes,
  shuffle,
} from "../shared/seeding";
import {
  SIDES,
  SIDE_VARIANT,
  bn,
  faucetClaimPda,
  faucetPda,
  getKeypair,
  getProgram,
  marketPda,
  positionPda,
  vaultPda,
} from "../shared/solana";

const logger = new Logger({ serviceName: "movex-equities-seeder" });

interface SeedWallet {
  index: number;
  keypair: Keypair;
  ata: PublicKey;
}

function quoteMint(): PublicKey {
  const value = process.env.QUOTE_MINT;
  if (!value) throw new Error("QUOTE_MINT is not set");
  return new PublicKey(value);
}

export const handler = async () => {
  const today = easternDate();
  try {
    if (!isTradingDay(today)) {
      logger.info("not a trading day", { today });
      return { deposited: [], claimed: [] };
    }
  } catch (err) {
    if (!(err instanceof CalendarCoverageError)) throw err;
    logger.error("calendar cannot vouch for today", { today });
    return { deposited: [], claimed: [] };
  }
  return seedMarkets(today);
};

/**
 * Funds both sides of every market `candidates(today)` names and claims what
 * the seed wallets have won.
 *
 * The handler gates this on a trading day. The local script does not, which
 * is how the next session's markets get their seed over a weekend: the
 * candidates for a Saturday already include Monday's hours and the ladder
 * that locks at Monday's close.
 */
export async function seedMarkets(
  today: string,
): Promise<{ deposited: string[]; claimed: string[] }> {
  const program = await getProgram();
  const publisher = await getKeypair();
  const connection = program.provider.connection;
  const mint = quoteMint();
  const now = Math.floor(Date.now() / 1000);

  // -- wallets ---------------------------------------------------------------
  const wallets: SeedWallet[] = [];
  for (let i = 0; i < SEED_WALLET_COUNT; i++) {
    const keypair = Keypair.fromSeed(seedBytes(publisher.secretKey, i));
    wallets.push({ index: i, keypair, ata: getAssociatedTokenAddressSync(mint, keypair.publicKey) });
  }
  logger.info("seed wallets", { addresses: wallets.map((w) => w.keypair.publicKey.toBase58()) });

  // -- SOL for rent, from the publisher ---------------------------------------
  for (const w of wallets) {
    const lamports = await connection.getBalance(w.keypair.publicKey);
    if (lamports >= SOL_REFILL_BELOW) continue;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: publisher.publicKey,
        toPubkey: w.keypair.publicKey,
        lamports: SOL_TARGET - lamports,
      }),
    );
    await program.provider.sendAndConfirm!(tx);
    logger.info("funded wallet with SOL", { wallet: w.index, lamports: SOL_TARGET - lamports });
  }

  // -- USDX accounts, created idempotently, publisher pays --------------------
  const ataTx = new Transaction();
  for (const w of wallets) {
    ataTx.add(
      createAssociatedTokenAccountIdempotentInstruction(publisher.publicKey, w.ata, w.keypair.publicKey, mint),
    );
  }
  await program.provider.sendAndConfirm!(ataTx);

  const accounts = program.account as unknown as {
    market: { fetch(a: PublicKey): Promise<any> };
    position: { fetch(a: PublicKey): Promise<any> };
    faucetClaim: { fetch(a: PublicKey): Promise<any> };
  };

  // -- USDX from the faucet, once the cooldown allows -------------------------
  const faucet = faucetPda(program.programId, mint);
  for (const w of wallets) {
    const claimPda = faucetClaimPda(program.programId, mint, w.keypair.publicKey);
    let due = true;
    try {
      const c = await accounts.faucetClaim.fetch(claimPda);
      due = Number(c.lastClaimTs) + FAUCET_COOLDOWN_SECS <= now;
    } catch {
      // No claim record yet: first draw.
    }
    if (!due) continue;

    try {
      await program.methods
        .faucetMint()
        .accounts({
          user: w.keypair.publicKey,
          faucet,
          claim: claimPda,
          mint,
          userTokenAccount: w.ata,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([w.keypair])
        .rpc();
      logger.info("faucet draw", { wallet: w.index });
    } catch (err) {
      logger.warn("faucet draw failed", {
        wallet: w.index,
        error: err instanceof Error ? err.message.split("\n")[0] : String(err),
      });
    }
  }

  // -- markets -----------------------------------------------------------------
  const specs = candidates(today);
  const addresses = specs.map((s) => marketPda(program.programId, s.symbol, s.sessionId, s.tier));
  const infos = await connection.getMultipleAccountsInfo(addresses);

  const deposited: string[] = [];
  const claimed: string[] = [];

  /** A market this run has something to do with, already read. */
  interface Target {
    label: string;
    market: PublicKey;
    vault: PublicKey;
    above: bigint;
    below: bigint;
    /**
     * A locked market with one side still empty. Deposits during the window
     * are capped, so this is not a place the protocol plays; it puts one
     * deposit on the empty side so the market can resolve, and nothing more.
     */
    rescue: boolean;
  }

  const toFund: Target[] = [];
  const toClaim: Target[] = [];

  for (let i = 0; i < specs.length; i++) {
    if (!infos[i]) continue;
    const spec = specs[i];
    const market = addresses[i];
    const label = `${spec.symbol}/${spec.sessionId}/${spec.tier}`;

    let m: any;
    try {
      m = await accounts.market.fetch(market);
    } catch {
      continue;
    }
    const state = Object.keys(m.state)[0];
    const above = BigInt(m.abovePool.toString());
    const below = BigInt(m.belowPool.toString());
    const target: Target = {
      label,
      market,
      vault: vaultPda(program.programId, market),
      above,
      below,
      rescue: false,
    };

    if (state === "open" && now < Number(m.lockTs)) {
      toFund.push(target);
    } else if (
      state === "locked" &&
      m.liveDeposits &&
      (above === 0n || below === 0n) &&
      now < Number(m.settleTs) - LIVE_CUTOFF_SECS
    ) {
      // An empty side no longer voids at lock; it voids at settle if it is
      // still empty then. There is a whole window to put one deposit on it.
      toFund.push({ ...target, rescue: true });
    } else if (state === "settled" || state === "voided") {
      toClaim.push(target);
    }
  }

  // A market missing a side is one settle away from voiding for want of a
  // counterparty, so it is funded before any market that already has both.
  // If the budget does run short, it runs short on depth rather than on
  // whether a market can resolve at all.
  const oneSided = (t: Target) => (t.above === 0n || t.below === 0n ? 1 : 0);
  toFund.sort((a, b) => oneSided(b) - oneSided(a));

  logger.info("markets to work on", {
    fund: toFund.length,
    oneSided: toFund.filter((t) => oneSided(t) === 1).length,
    rescue: toFund.filter((t) => t.rescue).length,
    claim: toClaim.length,
  });

  // ---- open: a subset of wallets each deposit once ---------------------------
  for (const [index, target] of toFund.entries()) {
    const { label, market, vault } = target;
    let abovePool = target.above;
    let belowPool = target.below;
    // Everything from here on, this market included, still to be paid for.
    const marketsRemaining = toFund.length - index;
    // A rescue wants exactly one deposit, on the side that is empty.
    const wanted = target.rescue ? 1 : DEPOSITORS_PER_MARKET;
    let backers = 0;

    // Shuffled so the wallets behind a market, and the one that lands the
    // forced side, differ from market to market.
    for (const w of shuffle(wallets)) {
      if (backers >= wanted) break;

      // A wallet is in if it holds either side. Positions are one per side,
      // so both addresses are checked. Already in counts: otherwise every
      // tick would pull in another wallet until all six were behind the
      // same market.
      let alreadyIn = false;
      for (const s of SIDES) {
        try {
          const p = await accounts.position.fetch(
            positionPda(program.programId, market, w.keypair.publicKey, s),
          );
          if (Number(p.amount) > 0) {
            alreadyIn = true;
            break;
          }
        } catch {
          // No position on that side.
        }
      }
      if (alreadyIn) {
        backers++;
        continue;
      }

      const side = chooseSide(abovePool, belowPool);
      const position = positionPda(program.programId, market, w.keypair.publicKey, side);
      const balance = (await getAccount(connection, w.ata)).amount;
      const amount = depositAmount(balance, marketsRemaining);

      if (amount === 0n) {
        logger.info("wallet short on USDX, skipping market", { label, wallet: w.index });
        continue;
      }

      try {
        await program.methods
          .deposit(SIDE_VARIANT[side], bn(amount))
          .accounts({
            user: w.keypair.publicKey,
            market,
            position,
            vault,
            userTokenAccount: w.ata,
            quoteMint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([w.keypair])
          .rpc();
        if (side === "above") abovePool += amount;
        else belowPool += amount;
        backers++;
        deposited.push(`${label}:${side}:${w.index}${target.rescue ? ":rescue" : ""}`);
      } catch (err) {
        logger.warn("deposit failed", {
          label,
          wallet: w.index,
          side,
          error: err instanceof Error ? err.message.split("\n")[0] : String(err),
        });
      }
    }

    // The one outcome worth shouting about. A side left at zero voids at
    // settle for want of a counterparty, so if every wallet was passed over
    // this says so now rather than leaving it to be found on the board.
    if (abovePool === 0n || belowPool === 0n) {
      logger.error("market still has an empty side after seeding", {
        label,
        backers,
        wallets: wallets.length,
        abovePool: abovePool.toString(),
        belowPool: belowPool.toString(),
      });
    }
  }

  // ---- resolved: claim what is ours -------------------------------------------
  // Every wallet and both sides, not a subset: which of them is holding a
  // winning position is whatever the draw did on the way in, and an
  // unclaimed one is money the next day's markets are counting on.
  for (const { label, market, vault } of toClaim) {
    for (const w of wallets) {
      for (const side of SIDES) {
        const position = positionPda(program.programId, market, w.keypair.publicKey, side);
        let p: any;
        try {
          p = await accounts.position.fetch(position);
        } catch {
          continue; // never deposited on this side
        }
        if (p.claimed || Number(p.amount) === 0) continue;

        // A losing position has nothing to claim and the program says so.
        // Trying is cheaper than working out the winner client-side.
        try {
          await program.methods
            .claim()
            .accounts({
              user: w.keypair.publicKey,
              market,
              position,
              vault,
              userTokenAccount: w.ata,
              quoteMint: mint,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([w.keypair])
            .rpc();
          claimed.push(`${label}:${side}:${w.index}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/NotOnWinningSide|AlreadyClaimed/.test(msg)) {
            logger.warn("claim failed", { label, wallet: w.index, side, error: msg.split("\n")[0] });
          }
        }
      }
    }
  }

  logger.info("seeder result", { deposited: deposited.length, claimed: claimed.length });
  return { deposited, claimed };
}
