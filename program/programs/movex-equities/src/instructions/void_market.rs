use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Market, MarketState},
};

/// The exit for a market that can no longer resolve.
///
/// `lock` and `settle` deliberately fail rather than void when the oracle is
/// unreadable, so a transient stale read can simply be retried. That leaves
/// one hole: a feed that never recovers would strand deposits forever.
///
/// This closes it. Permissionless, and only after the grace period, so it
/// cannot be used to void a market that a crank is about to resolve
/// correctly. Everyone refunds in full, with no fee taken, because a market
/// that did not resolve has not earned one.
#[derive(Accounts)]
pub struct VoidMarket<'info> {
    pub cranker: Signer<'info>,

    #[account(
        mut,
        seeds = [
            MARKET_SEED,
            market.underlying.as_ref(),
            market.session_date.as_ref(),
            market.tier.as_seed(),
        ],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,
}

pub fn handle_void_market(ctx: Context<VoidMarket>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let market = &mut ctx.accounts.market;

    require!(
        market.state == MarketState::Open || market.state == MarketState::Locked,
        ErrorCode::MarketAlreadyResolved
    );

    let deadline = market
        .settle_ts
        .checked_add(VOID_GRACE_SECS)
        .ok_or(ErrorCode::MathOverflow)?;
    require!(now > deadline, ErrorCode::TooEarlyToVoid);

    market.state = MarketState::Voided;

    msg!("voided: unresolved {} seconds past settle time", VOID_GRACE_SECS);
    Ok(())
}
