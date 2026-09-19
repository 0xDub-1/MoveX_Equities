use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    oracle::read_price,
    state::{Market, MarketState},
};

/// Records the reference price and closes withdrawals.
///
/// Permissionless. We run a keeper, but if it dies anyone can crank a market
/// forward with a short script, so the protocol never waits on us. That is
/// also the honest answer to a centralisation question.
///
/// A one-sided pot is not voided here. Deposits may still arrive during the
/// window, under the live cap, and a side that was empty at lock can be
/// filled by them. Whether a market ends up with a counterparty is decided
/// at settlement, which is the first moment it can be known.
#[derive(Accounts)]
pub struct Lock<'info> {
    /// Pays the fee. Anyone at all.
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

    /// CHECK: only ever read through `oracle::read_price`, and pinned to the
    /// feed this market was created with so a crank cannot substitute one.
    #[account(address = market.pyth_feed @ ErrorCode::OracleFeedMismatch)]
    pub price_feed: UncheckedAccount<'info>,
}

pub fn handle_lock(ctx: Context<Lock>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let market = &mut ctx.accounts.market;

    require!(market.state == MarketState::Open, ErrorCode::MarketNotOpen);
    require!(now >= market.lock_ts, ErrorCode::TooEarlyToLock);

    // Deliberately not voiding on an oracle failure. A stale read one second
    // after the close is a transient condition and this transaction can
    // simply be retried; killing the market permanently over it would be a
    // far worse outcome for depositors. `void_market` is the exit for a feed
    // that never recovers.
    let reading = read_price(&ctx.accounts.price_feed.to_account_info(), now)?;

    market.reference_price = reading.price;
    market.state = MarketState::Locked;

    msg!("locked at reference {}", reading.price);
    Ok(())
}
