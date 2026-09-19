use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::*,
    error::ErrorCode,
    payout::{distributable, live_group, payout, payout_live},
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

/// What a position is owed by the market as it resolved.
///
/// A voided market refunds every deposit, before and after lock, and takes
/// no fee. A settled one pays the winning side in two parts: the money that
/// was there before lock takes what the live group did not, and the live
/// money takes its group's share. Either part may be zero for a given
/// position; both are computed from pool totals alone.
pub fn claimable(market: &Market, position: &Position) -> Result<u64> {
    require!(!position.claimed, ErrorCode::AlreadyClaimed);
    require!(position.amount > 0, ErrorCode::NothingToClaim);

    match market.state {
        // Nothing was decided, so nothing is taken. Not even the fee: a
        // market that did not resolve has not earned one.
        MarketState::Voided => Ok(position.amount),

        MarketState::Settled => {
            let winner = market.winning_side.ok_or(ErrorCode::MarketNotResolved)?;
            require!(position.side == winner, ErrorCode::NotOnWinningSide);

            let pot = market.pot().ok_or(ErrorCode::MathOverflow)?;
            let dist = distributable(pot, market.fee_bps)?;

            let winning_pool = market.pool(winner);
            let live_pool = market.live(winner);
            let group = live_group(dist, winning_pool, live_pool)?;

            let pre_lock_pool = winning_pool
                .checked_sub(live_pool.amount)
                .ok_or(ErrorCode::MathOverflow)?;
            let pre_lock_amount = position
                .amount
                .checked_sub(position.live.amount)
                .ok_or(ErrorCode::MathOverflow)?;

            let mut total: u64 = 0;
            if pre_lock_amount > 0 {
                let for_pre_lock = dist.checked_sub(group).ok_or(ErrorCode::MathOverflow)?;
                total = total
                    .checked_add(payout(pre_lock_amount, for_pre_lock, pre_lock_pool)?)
                    .ok_or(ErrorCode::MathOverflow)?;
            }
            if position.live.amount > 0 {
                total = total
                    .checked_add(payout_live(&position.live, group, live_pool)?)
                    .ok_or(ErrorCode::MathOverflow)?;
            }
            Ok(total)
        }

        MarketState::Open | MarketState::Locked => Err(error!(ErrorCode::MarketNotResolved)),
    }
}

/// Moves `amount` out of the vault, signed by the market.
pub fn pay_from_vault<'info>(
    market: &Account<'info, Market>,
    vault: &Account<'info, TokenAccount>,
    quote_mint: &Account<'info, Mint>,
    to: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
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
            token_program.key(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: quote_mint.to_account_info(),
                to: to.to_account_info(),
                authority: market.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        quote_mint.decimals,
    )
}

pub fn handle_claim(ctx: Context<Claim>) -> Result<()> {
    let amount = claimable(&ctx.accounts.market, &ctx.accounts.position)?;

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

    pay_from_vault(
        &ctx.accounts.market,
        &ctx.accounts.vault,
        &ctx.accounts.quote_mint,
        &ctx.accounts.user_token_account,
        &ctx.accounts.token_program,
        amount,
    )?;

    msg!("claimed {}", amount);
    Ok(())
}
