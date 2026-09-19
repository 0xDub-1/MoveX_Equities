use anchor_lang::prelude::*;

#[constant]
pub const MARKET_SEED: &[u8] = b"market";

#[constant]
pub const POSITION_SEED: &[u8] = b"position";

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

#[cfg(feature = "keeper-oracle")]
#[constant]
pub const PRICE_FEED_SEED: &[u8] = b"price_feed";

/// Fixed scale for keeper-published prices, matching the exponent Pyth
/// readings are normalised to. One scale across both oracle implementations
/// means nothing downstream has to know which one it is talking to.
#[cfg(feature = "keeper-oracle")]
pub const KEEPER_PRICE_EXPONENT: i32 = -8;

#[cfg(feature = "devnet-faucet")]
#[constant]
pub const FAUCET_SEED: &[u8] = b"faucet";

#[cfg(feature = "devnet-faucet")]
#[constant]
pub const FAUCET_CLAIM_SEED: &[u8] = b"faucet_claim";

/// Upper bound on a single faucet claim, in USDX base units.
///
/// A bound rather than the amount itself. The per-faucet figure is set at
/// creation; this stops a fat-fingered `init_faucet` from handing out a
/// number that makes every pool ratio meaningless.
#[cfg(feature = "devnet-faucet")]
pub const MAX_FAUCET_CLAIM: u64 = 100_000_000_000;

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

// -- live round ---------------------------------------------------------------
//
// Deposits after lock carry a cap on what they can be paid, decaying from
// `live_max_multiple_bps` just after lock to `1 - fee` at settlement. These
// bound what any market may declare, in the spirit of MAX_FEE_BPS: the
// values themselves are set per market at creation and never change after.

/// Ceiling on `live_max_multiple_bps`: a live deposit may never be allowed
/// more than five times itself, however the market was configured.
pub const MAX_LIVE_MAX_MULTIPLE_BPS: u16 = 50_000;

/// Steepest decay of the live cap. Zero is a flat cap, one linear, and
/// three drives the cap to almost nothing by the last quarter of the window.
pub const MAX_LIVE_CAP_EXP: u8 = 3;

/// A live deposit must land at least this long before settlement.
///
/// The settle print is the last feed write before `settle_ts`, so a deposit
/// closer than one feed interval could be placed knowing that print. This is
/// the floor; a market should declare at least two intervals.
pub const MIN_LIVE_CUTOFF_SECS: u32 = 60;

/// How long past `settle_ts` a market must stay unresolved before anyone can
/// void it and release the deposits.
///
/// Wide enough that a crank running late, or an oracle blipping for a few
/// minutes, never loses a market that was about to settle correctly. Short
/// enough that a genuinely dead feed does not strand funds for a day.
pub const VOID_GRACE_SECS: i64 = 6 * 60 * 60;
