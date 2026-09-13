use anchor_lang::prelude::*;

use crate::constants::LOOKBACK_SESSIONS;

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
    /// Deposits closed, reference price recorded, measuring.
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
    pub above_pool: u64,
    pub below_pool: u64,
    /// Written at settle.
    pub winning_side: Option<Side>,
    pub fee_bps: u16,
    /// Deposits close at this time and the reference price is taken.
    pub lock_ts: i64,
    /// The settlement price is taken at this time.
    pub settle_ts: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Market {
    pub fn pot(&self) -> Option<u64> {
        self.above_pool.checked_add(self.below_pool)
    }
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub market: Pubkey,
    /// Which pool the deposit sits in. One position per user per market, so
    /// a user picks a side rather than holding both. Once `amount` returns
    /// to zero the side is free to change again.
    pub side: Side,
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}
