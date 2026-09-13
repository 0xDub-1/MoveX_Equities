use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Market, MarketState, Position, Side},
};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

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

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, market.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,

    #[account(mut, address = market.vault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(address = market.quote_mint)]
    pub quote_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_deposit(ctx: Context<Deposit>, side: Side, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(
        ctx.accounts.market.state == MarketState::Open,
        ErrorCode::MarketNotOpen
    );
    require!(
        now < ctx.accounts.market.lock_ts,
        ErrorCode::DepositWindowClosed
    );
    require!(amount >= MIN_DEPOSIT, ErrorCode::DepositTooSmall);

    let position = &mut ctx.accounts.position;

    // `init_if_needed` leaves a fresh account zeroed, so a default owner is
    // how a first deposit identifies itself.
    let is_new = position.owner == Pubkey::default();
    if is_new {
        position.owner = ctx.accounts.user.key();
        position.market = ctx.accounts.market.key();
        position.claimed = false;
        position.bump = ctx.bumps.position;
    }

    // One position per user per market, so a user holds a side rather than
    // both. Once a full withdrawal takes the balance back to zero the side
    // is free again, which keeps "withdraw and change my mind" working.
    if position.amount == 0 {
        position.side = side;
    } else {
        require!(position.side == side, ErrorCode::SideMismatch);
    }

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.user_token_account.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.quote_mint.decimals,
    )?;

    position.amount = position
        .amount
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    let market = &mut ctx.accounts.market;
    match side {
        Side::Above => {
            market.above_pool = market
                .above_pool
                .checked_add(amount)
                .ok_or(ErrorCode::MathOverflow)?
        }
        Side::Below => {
            market.below_pool = market
                .below_pool
                .checked_add(amount)
                .ok_or(ErrorCode::MathOverflow)?
        }
    }

    Ok(())
}
