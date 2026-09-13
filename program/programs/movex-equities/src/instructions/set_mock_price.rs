//! Development-only price setter.
//!
//! The entire module is gated on `dev-oracle`, so a build without that
//! feature has no instruction that can write a price at all. That is the
//! point: a runtime flag would be one bad admin transaction away from
//! settling real money against a number somebody typed in.

use anchor_lang::prelude::*;

use crate::{constants::*, state::MockPrice};

#[derive(Accounts)]
#[instruction(underlying: [u8; 8])]
pub struct SetMockPrice<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + MockPrice::INIT_SPACE,
        seeds = [MOCK_PRICE_SEED, underlying.as_ref()],
        bump,
    )]
    pub mock_price: Account<'info, MockPrice>,

    pub system_program: Program<'info, System>,
}

pub fn handle_set_mock_price(
    ctx: Context<SetMockPrice>,
    _underlying: [u8; 8],
    price: u64,
    publish_time: Option<i64>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let mock = &mut ctx.accounts.mock_price;
    mock.authority = ctx.accounts.authority.key();
    mock.price = price;
    // `None` means now. An Option rather than a zero sentinel, because zero
    // is a perfectly valid unix timestamp: litesvm's clock starts there, so
    // a sentinel silently turns "publish this an hour in the past" into
    // "publish this now" and a staleness test passes for the wrong reason.
    mock.publish_time = publish_time.unwrap_or(now);
    mock.bump = ctx.bumps.mock_price;

    Ok(())
}
