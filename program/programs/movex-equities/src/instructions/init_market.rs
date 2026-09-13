use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Market, MarketState, Tier},
    strike::verify_strike,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitMarketParams {
    /// Ticker as ASCII, right-padded with spaces. `b"NVDA    "`.
    pub underlying: [u8; 8],
    /// `YYYY-MM-DD` of the session whose close becomes the reference price.
    pub session_date: [u8; 10],
    pub tier: Tier,
    pub strike_bps: u16,
    /// The 20 close-to-close moves the strike was read from, sorted ascending.
    pub samples_bps: [u16; 20],
    pub fee_bps: u16,
    /// Wallet entitled to the fee on this market.
    pub treasury: Pubkey,
    pub lock_ts: i64,
    pub settle_ts: i64,
}

#[derive(Accounts)]
#[instruction(params: InitMarketParams)]
pub struct InitMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Market::INIT_SPACE,
        seeds = [
            MARKET_SEED,
            params.underlying.as_ref(),
            params.session_date.as_ref(),
            params.tier.as_seed(),
        ],
        bump,
    )]
    pub market: Account<'info, Market>,

    pub quote_mint: Account<'info, Mint>,

    /// Holds every deposit for this market. Its authority is the market PDA,
    /// so nothing can move funds except this program.
    #[account(
        init,
        payer = authority,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: the Pyth price account this market will settle against. Not
    /// read here; validated when `lock` and `settle` actually consume it.
    pub pyth_feed: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_market(ctx: Context<InitMarket>, params: InitMarketParams) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(params.fee_bps <= MAX_FEE_BPS, ErrorCode::FeeTooHigh);
    require!(
        params.strike_bps >= MIN_STRIKE_BPS,
        ErrorCode::StrikeTooSmall
    );
    require!(params.lock_ts > now, ErrorCode::LockTimeInPast);
    require!(
        params.settle_ts > params.lock_ts,
        ErrorCode::SettleBeforeLock
    );

    // The load-bearing check. The keeper supplies both a strike and the
    // series it came from, and the program refuses the market unless the
    // series actually produces that strike. A wrong number cannot reach
    // depositors, whether it got there by bug or by choice.
    verify_strike(&params.samples_bps, params.tier, params.strike_bps)?;

    let market = &mut ctx.accounts.market;
    market.authority = ctx.accounts.authority.key();
    market.underlying = params.underlying;
    market.session_date = params.session_date;
    market.tier = params.tier;
    market.pyth_feed = ctx.accounts.pyth_feed.key();
    market.quote_mint = ctx.accounts.quote_mint.key();
    market.vault = ctx.accounts.vault.key();
    market.strike_bps = params.strike_bps;
    market.samples_bps = params.samples_bps;
    market.state = MarketState::Open;
    market.reference_price = 0;
    market.settlement_price = 0;
    market.above_pool = 0;
    market.below_pool = 0;
    market.winning_side = None;
    market.fee_bps = params.fee_bps;
    market.treasury = params.treasury;
    market.fee_collected = false;
    market.lock_ts = params.lock_ts;
    market.settle_ts = params.settle_ts;
    market.bump = ctx.bumps.market;
    market.vault_bump = ctx.bumps.vault;

    msg!(
        "market open: strike {} bps, verified against its own {} samples",
        params.strike_bps,
        LOOKBACK_SESSIONS
    );

    Ok(())
}
