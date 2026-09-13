use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    oracle::{move_bps, read_price},
    state::{Market, MarketState, Side},
};

/// Records the settlement price, measures the move, and picks a side.
///
/// Permissionless, same as `lock`.
#[derive(Accounts)]
pub struct Settle<'info> {
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
    /// feed this market was created with.
    #[account(address = market.pyth_feed @ ErrorCode::OracleFeedMismatch)]
    pub price_feed: UncheckedAccount<'info>,
}

pub fn handle_settle(ctx: Context<Settle>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let market = &mut ctx.accounts.market;

    require!(
        market.state == MarketState::Locked,
        ErrorCode::MarketNotLocked
    );
    require!(now >= market.settle_ts, ErrorCode::TooEarlyToSettle);

    let reading = read_price(&ctx.accounts.price_feed.to_account_info(), now)?;
    let moved = move_bps(market.reference_price, reading.price)?;

    // Strictly greater. An exact tie goes to BELOW, which is stated in the
    // docs and in the UI rather than left to whichever way the comparison
    // happened to be written.
    let winner = if moved > market.strike_bps as u64 {
        Side::Above
    } else {
        Side::Below
    };

    market.settlement_price = reading.price;
    market.winning_side = Some(winner);
    market.state = MarketState::Settled;

    msg!(
        "settled: moved {} bps against a {} bps strike, {:?} wins",
        moved,
        market.strike_bps,
        winner
    );
    Ok(())
}
