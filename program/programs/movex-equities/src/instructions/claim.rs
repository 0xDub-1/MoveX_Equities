use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::*,
    error::ErrorCode,
    payout::{distributable, payout},
    state::{Market, MarketState, Position},
};

/// Collects a winning share, or a refund from a voided market.
#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// Not mutable. The pools stay as the record of what was deposited, so a
    /// claim never rewrites the denominator other claimants are dividing by.
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

    /// Seeds bind this to `user`, who signs, so no other position is
    /// reachable from here.
    #[account(
        mut,
        seeds = [POSITION_SEED, market.key().as_ref(), user.key().as_ref()],
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

pub fn handle_claim(ctx: Context<Claim>) -> Result<()> {
    require!(!ctx.accounts.position.claimed, ErrorCode::AlreadyClaimed);
    require!(
        ctx.accounts.position.amount > 0,
        ErrorCode::NothingToClaim
    );

    let market = &ctx.accounts.market;
    let position = &ctx.accounts.position;

    let amount = match market.state {
        // Nothing was decided, so nothing is taken. Not even the fee: a
        // market that did not resolve has not earned one.
        MarketState::Voided => position.amount,

        MarketState::Settled => {
            let winner = market.winning_side.ok_or(ErrorCode::MarketNotResolved)?;
            require!(position.side == winner, ErrorCode::NotOnWinningSide);

            let pot = market.pot().ok_or(ErrorCode::MathOverflow)?;
            let winning_pool = match winner {
                crate::state::Side::Above => market.above_pool,
                crate::state::Side::Below => market.below_pool,
            };

            payout(
                position.amount,
                distributable(pot, market.fee_bps)?,
                winning_pool,
            )?
        }

        MarketState::Open | MarketState::Locked => {
            return Err(error!(ErrorCode::MarketNotResolved))
        }
    };

    // Marked before the transfer. Anchor would unwind both on a failure
    // anyway, but the ordering makes the intent explicit: a claim is spent
    // whether or not the caller likes the number.
    ctx.accounts.position.claimed = true;

    if amount == 0 {
        // A winning position so small its share truncates to nothing. The
        // claim is still consumed, otherwise it stays open forever.
        msg!("claim resolved to zero, position closed");
        return Ok(());
    }

    let underlying = market.underlying;
    let session_date = market.session_date;
    let tier_seed = market.tier.as_seed();
    let bump = market.bump;

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

    msg!("claimed {}", amount);
    Ok(())
}
