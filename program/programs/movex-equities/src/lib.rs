//! MoveX Equities
//!
//! Daily volatility markets on US stocks. Each market asks one question:
//! did this stock move more or less than a threshold, in either direction?
//!
//! Two pools, no order book, no leverage, no liquidations. The worst outcome
//! available to a depositor is losing the stake they chose.
//!
//! A market's life:
//!
//! ```text
//!   init_market ──► deposit / withdraw ──► lock ──► settle ──► claim
//!                                            │         │
//!                                            └─ void ──┴──────► claim (refund)
//! ```

pub mod constants;
pub mod error;
pub mod instructions;
pub mod oracle;
pub mod payout;
pub mod state;
pub mod strike;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("9j2X63EpuSxBSqfMKNrcbQUFzzrXiU8ok2PbUYucZ8zL");

#[program]
pub mod movex_equities {
    use super::*;

    /// Creates a market with a frozen strike and its own vault.
    ///
    /// The strike is not taken on trust. The instruction recomputes the
    /// percentile from the sample series it was given and rejects the market
    /// unless the two agree.
    pub fn init_market(ctx: Context<InitMarket>, params: InitMarketParams) -> Result<()> {
        crate::instructions::init_market::handle_init_market(ctx, params)
    }

    /// Deposits into ABOVE or BELOW. Open until the market locks.
    pub fn deposit(ctx: Context<Deposit>, side: Side, amount: u64) -> Result<()> {
        crate::instructions::deposit::handle_deposit(ctx, side, amount)
    }

    /// Pulls a deposit back out. Only before lock.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        crate::instructions::withdraw::handle_withdraw(ctx, amount)
    }

    /// Freezes deposits and records the reference price. Permissionless.
    pub fn lock(ctx: Context<Lock>) -> Result<()> {
        crate::instructions::lock::handle_lock(ctx)
    }

    /// Records the settlement price and picks a side. Permissionless.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        crate::instructions::settle::handle_settle(ctx)
    }

    /// Collects a winning share, or a refund from a voided market.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        crate::instructions::claim::handle_claim(ctx)
    }

    /// Releases a market that never resolved. Permissionless, and only after
    /// the grace period.
    pub fn void_market(ctx: Context<VoidMarket>) -> Result<()> {
        crate::instructions::void_market::handle_void_market(ctx)
    }

    /// Development only, compiled out without `dev-oracle`.
    #[cfg(feature = "dev-oracle")]
    pub fn set_mock_price(
        ctx: Context<SetMockPrice>,
        underlying: [u8; 8],
        price: u64,
        publish_time: Option<i64>,
    ) -> Result<()> {
        crate::instructions::set_mock_price::handle_set_mock_price(
            ctx,
            underlying,
            price,
            publish_time,
        )
    }
}
