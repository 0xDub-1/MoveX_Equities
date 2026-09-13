//! MoveX Equities
//!
//! Daily volatility markets on US stocks. Each market asks one question:
//! did this stock move more or less than a threshold, in either direction?
//!
//! Two pools, no order book, no leverage, no liquidations. The worst outcome
//! available to a depositor is losing the stake they chose.
//!
//! Phase 1 covers market creation and the deposit path. `lock`, `settle` and
//! `claim` arrive in Phase 2.

pub mod constants;
pub mod error;
pub mod instructions;
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
}
