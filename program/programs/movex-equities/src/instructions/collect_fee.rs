use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::*,
    error::ErrorCode,
    payout::fee_amount,
    state::{Market, MarketState},
};

/// Withdraws the protocol fee a settled market withheld.
///
/// The fee itself is taken at claim time: every payout divides the pot
/// *after* the fee, so the amount below is already sitting in the vault
/// untouched. This instruction only moves it out.
///
/// Safe to call at any point after settlement, including before winners have
/// claimed. Payouts divide `pot - fee`, and integer division truncates, so
/// what remains for claimants is always at least what they are owed.
#[derive(Accounts)]
pub struct CollectFee<'info> {
    /// Anyone may push the fee to the treasury. It can only go to the
    /// address the market was created with, so there is nothing to gain by
    /// calling it and no reason to gate it.
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

    #[account(mut, address = market.vault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = market.treasury,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    #[account(address = market.quote_mint)]
    pub quote_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_collect_fee(ctx: Context<CollectFee>) -> Result<()> {
    // Copied out first: the market is mutated below and also serves as the
    // transfer authority, so it cannot stay borrowed.
    let state = ctx.accounts.market.state;
    let already_collected = ctx.accounts.market.fee_collected;
    let pot = ctx.accounts.market.pot().ok_or(ErrorCode::MathOverflow)?;
    let fee_bps = ctx.accounts.market.fee_bps;
    let underlying = ctx.accounts.market.underlying;
    let session_date = ctx.accounts.market.session_date;
    let tier_seed = ctx.accounts.market.tier.as_seed();
    let bump = ctx.accounts.market.bump;

    // Only a market that resolved. A voided one refunds in full and has not
    // earned a fee, and an open or locked one has not finished.
    require!(state == MarketState::Settled, ErrorCode::MarketNotResolved);
    require!(!already_collected, ErrorCode::FeeAlreadyCollected);

    let amount = fee_amount(pot, fee_bps)?;

    ctx.accounts.market.fee_collected = true;

    if amount == 0 {
        msg!("no fee on this market");
        return Ok(());
    }

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
                to: ctx.accounts.treasury_token_account.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.quote_mint.decimals,
    )?;

    msg!("collected {} in fees", amount);
    Ok(())
}
