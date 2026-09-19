use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Market, MarketState, Position},
};

/// The escape hatch. Available only while the market is open, which is the
/// whole point: once the reference price is taken the bet is live and there
/// is nothing left to back out of. Deposits may keep arriving after that
/// under the live cap; withdrawals may not, or the losing side would empty
/// itself the moment the outcome showed.
#[derive(Accounts)]
pub struct Withdraw<'info> {
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

    /// The seeds already bind this to `user`, who signs, so no separate
    /// ownership constraint is needed: no other user's position can be
    /// passed here at all.
    #[account(
        mut,
        seeds = [POSITION_SEED, market.key().as_ref(), user.key().as_ref(), position.side.as_seed()],
        bump = position.bump,
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
}

pub fn handle_withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(
        ctx.accounts.market.state == MarketState::Open,
        ErrorCode::MarketNotOpen
    );
    require!(
        now < ctx.accounts.market.lock_ts,
        ErrorCode::DepositWindowClosed
    );
    require!(
        amount > 0 && amount <= ctx.accounts.position.amount,
        ErrorCode::InsufficientPosition
    );

    let side = ctx.accounts.position.side;

    // Copied out before the CPI so the market account is not borrowed while
    // it is also serving as the transfer authority.
    let underlying = ctx.accounts.market.underlying;
    let session_date = ctx.accounts.market.session_date;
    let tier_seed = ctx.accounts.market.tier.as_seed();
    let bump = ctx.accounts.market.bump;

    let signer_seeds: &[&[&[u8]]] = &[&[
        MARKET_SEED,
        underlying.as_ref(),
        session_date.as_ref(),
        tier_seed,
        &[bump],
    ]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.quote_mint.decimals,
    )?;

    let position = &mut ctx.accounts.position;
    position.amount = position
        .amount
        .checked_sub(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    let market = &mut ctx.accounts.market;
    let pool = market.pool_mut(side);
    *pool = pool.checked_sub(amount).ok_or(ErrorCode::MathOverflow)?;

    Ok(())
}
