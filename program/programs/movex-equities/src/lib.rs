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

    /// Deposits into ABOVE or BELOW. Before lock at full weight; after lock,
    /// where the market allows it, under a cap that decays to the deposit
    /// less the fee at settlement.
    pub fn deposit(ctx: Context<Deposit>, side: Side, amount: u64) -> Result<()> {
        crate::instructions::deposit::handle_deposit(ctx, side, amount)
    }

    /// Pulls a deposit back out. Only before lock.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        crate::instructions::withdraw::handle_withdraw(ctx, amount)
    }

    /// Records the reference price and closes withdrawals. Permissionless.
    pub fn lock(ctx: Context<Lock>) -> Result<()> {
        crate::instructions::lock::handle_lock(ctx)
    }

    /// Records the settlement price and picks a side, or voids a market
    /// whose losing side is empty. Permissionless.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        crate::instructions::settle::handle_settle(ctx)
    }

    /// Collects a winning share, or a refund from a voided market.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        crate::instructions::claim::handle_claim(ctx)
    }

    /// Pays a resolved position to its owner's token account. Anyone may
    /// call it: the destination is derived from the owner, so nothing can
    /// be sent anywhere else.
    pub fn claim_for_owner(ctx: Context<ClaimForOwner>) -> Result<()> {
        crate::instructions::claim_for::handle_claim_for_owner(ctx)
    }

    /// Releases a market that never resolved. Permissionless, and only after
    /// the grace period.
    pub fn void_market(ctx: Context<VoidMarket>) -> Result<()> {
        crate::instructions::void_market::handle_void_market(ctx)
    }

    /// Pushes a settled market's protocol fee to its treasury.
    pub fn collect_fee(ctx: Context<CollectFee>) -> Result<()> {
        crate::instructions::collect_fee::handle_collect_fee(ctx)
    }

    /// Opens a test-token faucet. Compiled out without `devnet-faucet`.
    #[cfg(feature = "devnet-faucet")]
    pub fn init_faucet(
        ctx: Context<InitFaucet>,
        amount_per_claim: u64,
        cooldown_secs: i64,
    ) -> Result<()> {
        crate::instructions::faucet::handle_init_faucet(ctx, amount_per_claim, cooldown_secs)
    }

    /// Mints one allowance of the test token, subject to the cooldown.
    #[cfg(feature = "devnet-faucet")]
    pub fn faucet_mint(ctx: Context<FaucetMint>) -> Result<()> {
        crate::instructions::faucet::handle_faucet_mint(ctx)
    }

    /// Opens a keeper-published price feed for one underlying.
    ///
    /// Compiled out without `keeper-oracle`: a mainnet build reads Pyth and
    /// has no instruction capable of writing a price at all.
    #[cfg(feature = "keeper-oracle")]
    pub fn init_price_feed(
        ctx: Context<InitPriceFeed>,
        underlying: [u8; 8],
        publisher: Pubkey,
    ) -> Result<()> {
        crate::instructions::price_feed::handle_init_price_feed(ctx, underlying, publisher)
    }

    /// Publishes a price. Only the feed's publisher may call it.
    #[cfg(feature = "keeper-oracle")]
    pub fn update_price(
        ctx: Context<UpdatePrice>,
        price: u64,
        conf: u64,
        publish_time: i64,
        source_count: u8,
    ) -> Result<()> {
        crate::instructions::price_feed::handle_update_price(
            ctx,
            price,
            conf,
            publish_time,
            source_count,
        )
    }
}
