//! Keeper-published price feeds.
//!
//! Gated on `keeper-oracle`. A production build has no instruction that can
//! write a price, which is the property worth keeping: the mainnet binary
//! reads Pyth and nothing else.

use anchor_lang::prelude::*;

use crate::{constants::*, error::ErrorCode, oracle::MAX_CONFIDENCE_RATIO, state::PriceFeed};

// ---------------------------------------------------------------------------
// init_price_feed
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(underlying: [u8; 8])]
pub struct InitPriceFeed<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + PriceFeed::INIT_SPACE,
        seeds = [PRICE_FEED_SEED, underlying.as_ref()],
        bump,
    )]
    pub price_feed: Account<'info, PriceFeed>,

    pub system_program: Program<'info, System>,
}

pub fn handle_init_price_feed(
    ctx: Context<InitPriceFeed>,
    underlying: [u8; 8],
    publisher: Pubkey,
) -> Result<()> {
    let feed = &mut ctx.accounts.price_feed;
    feed.underlying = underlying;
    feed.publisher = publisher;
    feed.price = 0;
    feed.conf = 0;
    // Zero rather than "now": a feed with no price yet must read as
    // unusable, and `read_price` rejects a zero price outright.
    feed.publish_time = 0;
    feed.posted_slot = 0;
    feed.source_count = 0;
    feed.bump = ctx.bumps.price_feed;

    msg!("price feed open, publisher {}", publisher);
    Ok(())
}

// ---------------------------------------------------------------------------
// update_price
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    /// Constrained to the publisher the feed was created with, so a feed
    /// cannot be hijacked by whoever calls first.
    pub publisher: Signer<'info>,

    #[account(
        mut,
        seeds = [PRICE_FEED_SEED, price_feed.underlying.as_ref()],
        bump = price_feed.bump,
        has_one = publisher @ ErrorCode::OracleUnauthorizedPublisher,
    )]
    pub price_feed: Account<'info, PriceFeed>,
}

pub fn handle_update_price(
    ctx: Context<UpdatePrice>,
    price: u64,
    conf: u64,
    publish_time: i64,
    source_count: u8,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let feed = &mut ctx.accounts.price_feed;

    require!(price > 0, ErrorCode::OraclePriceInvalid);
    require!(source_count > 0, ErrorCode::OraclePriceInvalid);

    // A price stamped in the future is a broken publisher, not a fresh one.
    require!(publish_time <= now + 1, ErrorCode::OraclePriceInvalid);

    // Strictly forward. Without this, a stale update could be replayed after
    // a fresh one and quietly roll the feed backwards, which at settlement
    // time is the difference between the right answer and a plausible one.
    require!(
        publish_time > feed.publish_time,
        ErrorCode::OraclePriceNotNewer
    );

    // Same bound the Pyth path applies to its confidence interval. Sources
    // that disagree this much are not a price, they are a range.
    let max_conf = price
        .checked_div(MAX_CONFIDENCE_RATIO)
        .ok_or(ErrorCode::MathOverflow)?;
    require!(conf <= max_conf, ErrorCode::OracleConfidenceTooWide);

    feed.price = price;
    feed.conf = conf;
    feed.publish_time = publish_time;
    feed.posted_slot = clock.slot;
    feed.source_count = source_count;

    Ok(())
}
