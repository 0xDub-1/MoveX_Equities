// =============================================================================
// Error translation
// =============================================================================
//
// A failed transaction arrives as an AnchorError, a raw "custom program
// error: 0x1771", a wallet rejection, or a system program complaint about
// lamports. Users get one sentence that says what to do about it.

import idl from "./idl/movex_equities.json";

export interface DescribedError {
  title: string;
  message: string;
  /** The user declined in the wallet. Not worth an error toast. */
  cancelled: boolean;
}

const BY_CODE = new Map(idl.errors.map((e) => [e.code, e]));
const BY_NAME = new Map(idl.errors.map((e) => [e.name, e]));

/** Program errors, said the way a depositor would want to hear them. */
const FRIENDLY: Record<string, string> = {
  MarketNotOpen: "This market is no longer taking deposits.",
  DepositWindowClosed: "The deposit window has closed for this market.",
  DepositTooSmall: "The minimum deposit is 1 USDX.",
  InsufficientPosition: "That is more than your position holds.",
  SideMismatch: "You already hold the other side of this market. Withdraw first to switch.",
  MarketNotResolved: "This market has not resolved yet.",
  AlreadyClaimed: "This position has already been claimed.",
  NotOnWinningSide: "This position was on the losing side. There is nothing to claim.",
  NothingToClaim: "There is nothing to claim on this position.",
  FaucetCooldownActive: "The faucet is on cooldown for this wallet. Try again later.",
  OraclePriceStale: "The oracle price is stale right now.",
};

function fromCode(code: number): DescribedError | null {
  const entry = BY_CODE.get(code);
  if (!entry) return null;
  return {
    title: entry.name.replace(/([a-z])([A-Z])/g, "$1 $2"),
    message: FRIENDLY[entry.name] ?? entry.msg,
    cancelled: false,
  };
}

interface AnchorErrorShape {
  error?: { errorCode?: { code?: string; number?: number }; errorMessage?: string };
  logs?: string[];
  message?: string;
}

export function describeError(err: unknown): DescribedError {
  const e = (err ?? {}) as AnchorErrorShape;
  const message = typeof err === "string" ? err : (e.message ?? String(err));

  if (/user rejected|rejected the request|user declined|cancel/i.test(message)) {
    return { title: "Cancelled", message: "Transaction cancelled in the wallet.", cancelled: true };
  }

  const codeName = e.error?.errorCode?.code;
  if (codeName && BY_NAME.has(codeName)) {
    const entry = BY_NAME.get(codeName)!;
    return fromCode(entry.code)!;
  }
  const codeNumber = e.error?.errorCode?.number;
  if (typeof codeNumber === "number") {
    const described = fromCode(codeNumber);
    if (described) return described;
  }

  const hex = /custom program error: 0x([0-9a-f]+)/i.exec(message);
  if (hex) {
    const code = parseInt(hex[1], 16);
    const described = fromCode(code);
    if (described) return described;
    if (code === 1) {
      return {
        title: "Insufficient funds",
        message: "The token account does not hold enough USDX for this amount.",
        cancelled: false,
      };
    }
  }

  const logs = (e.logs ?? []).join("\n");
  const haystack = `${message}\n${logs}`;

  if (/insufficient lamports|found no record of a prior credit|insufficient funds for rent/i.test(haystack)) {
    return {
      title: "Not enough SOL",
      message: "This wallet needs a little devnet SOL for fees and rent. Use the Solana faucet, then retry.",
      cancelled: false,
    };
  }
  if (/insufficient funds/i.test(haystack)) {
    return {
      title: "Insufficient USDX",
      message: "The wallet does not hold enough USDX. Draw from the faucet on the portfolio page.",
      cancelled: false,
    };
  }
  if (/blockhash not found|block height exceeded|expired/i.test(haystack)) {
    return {
      title: "Network timing",
      message: "The transaction expired before it confirmed. Please try again.",
      cancelled: false,
    };
  }
  if (/wallet not connected|WalletNotConnected/i.test(haystack)) {
    return { title: "No wallet", message: "Connect a wallet first.", cancelled: false };
  }

  return {
    title: "Transaction failed",
    message: message.split("\n")[0].slice(0, 200) || "Unknown error.",
    cancelled: false,
  };
}
