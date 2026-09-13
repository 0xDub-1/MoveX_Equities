use anchor_lang::prelude::*;

#[constant]
pub const MARKET_SEED: &[u8] = b"market";

#[constant]
pub const POSITION_SEED: &[u8] = b"position";

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

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
