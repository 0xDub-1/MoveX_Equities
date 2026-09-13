use anchor_lang::prelude::*;

#[constant]
pub const MARKET_SEED: &[u8] = b"market";

#[constant]
pub const POSITION_SEED: &[u8] = b"position";

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

#[cfg(feature = "dev-oracle")]
#[constant]
pub const MOCK_PRICE_SEED: &[u8] = b"mock_price";

/// Sessions the strike ladder is calibrated on. Fixed, because the on-chain
/// percentile check indexes into the series at hardcoded positions.
pub const LOOKBACK_SESSIONS: usize = 20;

/// Ceiling on the protocol fee. Not the fee itself, a bound on what any
/// market is allowed to declare, so a fat-fingered `init_market` cannot
/// create a market that takes most of the pot.
pub const MAX_FEE_BPS: u16 = 500;

/// A strike of zero would make every session win ABOVE by default.
pub const MIN_STRIKE_BPS: u16 = 1;

/// Smallest deposit, in USDC base units (6 decimals), so dust positions
/// cannot bloat the vault's rent or produce payouts that round to nothing.
pub const MIN_DEPOSIT: u64 = 1_000_000;

/// How long past `settle_ts` a market must stay unresolved before anyone can
/// void it and release the deposits.
///
/// Wide enough that a crank running late, or an oracle blipping for a few
/// minutes, never loses a market that was about to settle correctly. Short
/// enough that a genuinely dead feed does not strand funds for a day.
pub const VOID_GRACE_SECS: i64 = 6 * 60 * 60;
