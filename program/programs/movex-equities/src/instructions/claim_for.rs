use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::{
    constants::*,
    error::ErrorCode,
    instructions::claim::{claimable, pay_from_vault},
    state::{Market, Position},
};

/// Pays a resolved position to its owner without the owner signing.
///
/// Winnings left unclaimed are the owner's money, and the answer to "people
/// forget" is to deliver it, not to keep it. Anyone may call this, the
/// keeper included. The destination is the owner's associated token account,
/// derived here from the owner and the mint, so there is no account in this
/// instruction through which funds could go anywhere else.
#[derive(Accounts)]
pub struct ClaimForOwner<'info> {
    /// Pays for the owner's token account if it does not exist yet.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: never read and never signs. Used only as a seed for the
    /// position and to derive the token account the payout goes to.
    pub owner: UncheckedAccount<'info>,

    #[account(
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
        mut,
        seeds = [POSITION_SEED, market.key().as_ref(), owner.key().as_ref(), position.side.as_seed()],
        bump = position.bump,
        constraint = position.owner == owner.key() @ ErrorCode::NothingToClaim,
    )]
    pub position: Account<'info, Position>,

    #[account(mut, address = market.vault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = quote_mint,
        associated_token::authority = owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    #[account(address = market.quote_mint)]
    pub quote_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim_for_owner(ctx: Context<ClaimForOwner>) -> Result<()> {
    let amount = claimable(&ctx.accounts.market, &ctx.accounts.position)?;

    ctx.accounts.position.claimed = true;

    if amount == 0 {
        msg!("claim resolved to zero, position closed");
        return Ok(());
    }

    pay_from_vault(
        &ctx.accounts.market,
        &ctx.accounts.vault,
        &ctx.accounts.quote_mint,
        &ctx.accounts.owner_token_account,
        &ctx.accounts.token_program,
        amount,
    )?;

    msg!("claimed {} for {}", amount, ctx.accounts.owner.key());
    Ok(())
}
