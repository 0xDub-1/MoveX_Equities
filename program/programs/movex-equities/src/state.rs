use anchor_lang::prelude::*;

use crate::{constants::LOOKBACK_SESSIONS, error::ErrorCode};

/// The percentile check in `strike.rs` indexes the series at fixed positions
/// derived from a 20-session window. Changing the lookback without redoing
/// that maths would silently verify the wrong quantile.
const _: () = assert!(LOOKBACK_SESSIONS == 20);

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Tier {
    /// P25. Roughly three sessions in four exceed it.
    Tight,
    /// P50. The coin flip.
    Fair,
    /// P75. Roughly one session in four exceeds it.
    Wide,
}

impl Tier {
    /// Seed component for the market PDA.
    ///
    /// A `&'static [u8]` rather than the enum discriminant so no temporary
    /// has to outlive the seeds expression, and so the derived address is
    /// readable rather than a bare byte.
    pub const fn as_seed(&self) -> &'static [u8] {
        match self {
            Tier::Tight => b"tight",
            Tier::Fair => b"fair",
            Tier::Wide => b"wide",
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum MarketState {
    /// Accepting deposits and withdrawals.
    Open,
    /// Reference price recorded, measuring. Deposits may still arrive under
    /// the live cap where the market allows it; withdrawals may not.
    Locked,
    /// Settlement price recorded, a side won, pot is claimable.
    Settled,
    /// Something made the market unresolvable. Everyone refunds in full.
    Voided,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Side {
    /// Moves more than the strike, in either direction.
    Above,
    /// Moves less than the strike. Wins an exact tie.
    Below,
}

impl Side {
    /// Seed component for the position PDA, so a user holds one position
    /// per side rather than one per market.
    pub const fn as_seed(&self) -> &'static [u8] {
        match self {
            Side::Above => b"above",
            Side::Below => b"below",
        }
    }

    pub const fn opposite(&self) -> Side {
        match self {
            Side::Above => Side::Below,
            Side::Below => Side::Above,
        }
    }
}

/// Deposits that arrived after lock, reduced to the three integers the
/// payout needs. Kept on the market per side, and on each position for its
/// own share, accumulated with exactly the same terms so that every division
/// at claim time is by a sum of what it distributes.
///
/// `floor` is the least this money is paid back if its side wins, the
/// deposits less the fee. `excess` is how much more its cap allows, which is
/// what decays with the time left when each deposit landed.
#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq, Debug, InitSpace,
)]
pub struct LiveTotals {
    pub amount: u64,
    pub floor: u64,
    pub excess: u64,
}

impl LiveTotals {
    /// The most this money can be paid in total.
    pub fn cap(&self) -> Result<u64> {
        self.floor
            .checked_add(self.excess)
            .ok_or(error!(ErrorCode::MathOverflow))
    }

    pub fn add(&mut self, other: &LiveTotals) -> Result<()> {
        self.amount = self
            .amount
            .checked_add(other.amount)
            .ok_or(ErrorCode::MathOverflow)?;
        self.floor = self
            .floor
            .checked_add(other.floor)
            .ok_or(ErrorCode::MathOverflow)?;
        self.excess = self
            .excess
            .checked_add(other.excess)
            .ok_or(ErrorCode::MathOverflow)?;
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    /// Allowed to create the market. Settlement is permissionless.
    pub authority: Pubkey,
    /// Ticker as ASCII, right-padded with spaces. Part of the PDA seeds.
    pub underlying: [u8; 8],
    /// `YYYY-MM-DD` of the session whose close is the reference price.
    pub session_date: [u8; 10],
    pub tier: Tier,
    /// Pyth price account this market settles against.
    pub pyth_feed: Pubkey,
    /// SPL mint deposits are denominated in (USDC).
    pub quote_mint: Pubkey,
    pub vault: Pubkey,

    /// The threshold, in basis points. 155 = 1.55%.
    ///
    /// Not taken on trust: `init_market` recomputes the percentile from
    /// `samples_bps` and rejects the market unless they agree. The strike is
    /// enforced by the program, not merely asserted by the keeper.
    pub strike_bps: u16,

    /// The 20 absolute close-to-close moves the strike was read from, in
    /// basis points, sorted ascending.
    ///
    /// These are the public justification for the threshold. Holding them on
    /// chain is the difference between "trust our API" and "here are the
    /// twenty numbers, and the program checked them itself".
    pub samples_bps: [u16; 20],

    pub state: MarketState,
    /// Written at lock. Zero until then.
    pub reference_price: u64,
    /// Written at settle. Zero until then.
    pub settlement_price: u64,
    /// Everything deposited on each side, before and after lock.
    pub above_pool: u64,
    pub below_pool: u64,
    /// The part of each pool that arrived after lock, with its cap.
    pub live_above: LiveTotals,
    pub live_below: LiveTotals,
    /// Written at settle.
    pub winning_side: Option<Side>,
    pub fee_bps: u16,
    /// Wallet entitled to the protocol fee. The destination token account
    /// must be owned by it, so the fee has a declared home from the moment
    /// the market is created rather than being decided later.
    pub treasury: Pubkey,
    /// The fee is a single withdrawal, not a running balance.
    pub fee_collected: bool,
    /// Withdrawals close at this time and the reference price is taken.
    pub lock_ts: i64,
    /// The settlement price is taken at this time.
    pub settle_ts: i64,

    /// Whether deposits stay open after lock. The switch for the whole live
    /// round: off, and the market behaves exactly as one without it.
    pub live_deposits: bool,
    /// The most a live deposit may be paid, in basis points of itself, for
    /// one landing the instant the market locks. Decays from there.
    pub live_max_multiple_bps: u16,
    /// How fast that maximum decays over the window. Zero is flat.
    pub live_cap_exp: u8,
    /// Live deposits close this many seconds before settlement, so nothing
    /// can be placed knowing the print the market will settle on.
    pub live_cutoff_secs: u32,

    pub bump: u8,
    pub vault_bump: u8,
}

impl Market {
    pub fn pot(&self) -> Option<u64> {
        self.above_pool.checked_add(self.below_pool)
    }

    pub fn pool(&self, side: Side) -> u64 {
        match side {
            Side::Above => self.above_pool,
            Side::Below => self.below_pool,
        }
    }

    pub fn pool_mut(&mut self, side: Side) -> &mut u64 {
        match side {
            Side::Above => &mut self.above_pool,
            Side::Below => &mut self.below_pool,
        }
    }

    pub fn live(&self, side: Side) -> &LiveTotals {
        match side {
            Side::Above => &self.live_above,
            Side::Below => &self.live_below,
        }
    }

    pub fn live_mut(&mut self, side: Side) -> &mut LiveTotals {
        match side {
            Side::Above => &mut self.live_above,
            Side::Below => &mut self.live_below,
        }
    }
}

/// A price published by our own keeper.
///
/// Deliberately shaped like a Pyth sponsored feed: one fixed address per
/// underlying, updated continuously, read by both the program and the UI.
/// That is not imitation for its own sake. It means swapping to Pyth on
/// mainnet changes one file rather than the shape of everything above it.
///
/// What it lacks compared to Pyth is not structure, it is publishers. There
/// is exactly one and it is us, which is stated plainly in the README rather
/// than papered over. It exists because Pyth moved Hermes behind a $500/month
/// key in August 2026, which is outside a hackathon budget.
///
/// Compiled out entirely without `keeper-oracle`, so a production build has
/// no such account type and no instruction that writes one.
#[cfg(feature = "keeper-oracle")]
#[account]
#[derive(InitSpace)]
pub struct PriceFeed {
    pub underlying: [u8; 8],
    /// The only key allowed to write prices here.
    pub publisher: Pubkey,
    /// Scaled by `KEEPER_PRICE_EXPONENT`.
    pub price: u64,
    /// Spread across the sources that agreed on it, same scale.
    ///
    /// The analogue of Pyth's confidence interval, and consumed by exactly
    /// the same check: a wide band means the sources disagree and the market
    /// refuses to settle rather than picking a number out of the spread.
    pub conf: u64,
    /// When the *source* produced this price, not when it was written here.
    ///
    /// The distinction is the whole staleness check. A price written a second
    /// ago carrying Friday's close is stale, and must read as stale.
    pub publish_time: i64,
    /// Slot of the write. Only for diagnosing publisher lag.
    pub posted_slot: u64,
    /// How many independent sources agreed on this price.
    pub source_count: u8,
    pub bump: u8,
}

/// Configuration for a self-serve test-token faucet.
///
/// The PDA itself is the mint authority, so the only way to create supply is
/// through `faucet_mint` and its cooldown. Gated on `devnet-faucet`: a
/// production build has no instruction that can mint the quote asset.
#[cfg(feature = "devnet-faucet")]
#[account]
#[derive(InitSpace)]
pub struct Faucet {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub amount_per_claim: u64,
    pub cooldown_secs: i64,
    pub bump: u8,
}

/// One user's claim history against one faucet.
#[cfg(feature = "devnet-faucet")]
#[account]
#[derive(InitSpace)]
pub struct FaucetClaim {
    pub faucet: Pubkey,
    pub user: Pubkey,
    pub last_claim_ts: i64,
    pub total_claimed: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub market: Pubkey,
    /// Which pool this position sits in. The side is part of the account's
    /// address, so one user may hold one position per side of a market and
    /// the two never mix.
    pub side: Side,
    /// Everything deposited, before and after lock.
    pub amount: u64,
    /// The part of `amount` that arrived after lock, with its cap.
    pub live: LiveTotals,
    pub claimed: bool,
    pub bump: u8,
}
