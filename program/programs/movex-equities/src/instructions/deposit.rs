use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::*,
    error::ErrorCode,
    payout::{live_multiple_bps, live_terms},
    state::{LiveTotals, Market, MarketState, Position, Side},
};

#[derive(Accounts)]
#[instruction(side: Side)]
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

    /// One per user, market and side. The side is in the address, so a user
    /// holding both sides holds two of these and neither can touch the other.
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, market.key().as_ref(), user.key().as_ref(), side.as_seed()],
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
    require!(amount >= MIN_DEPOSIT, ErrorCode::DepositTooSmall);

    // Which window the deposit lands in decides what it is recorded as.
    let live: Option<LiveTotals> = {
        let market = &ctx.accounts.market;
        match market.state {
            // Before lock: full weight and no cap. The market exactly as it
            // was before live deposits existed.
            MarketState::Open => {
                require!(now < market.lock_ts, ErrorCode::DepositWindowClosed);
                None
            }

            // After lock: only where the market allows it, only until the
            // cutoff, and carrying the cap the time left permits. The
            // reference price is known by now, so this money can never be
            // paid more than that cap, whatever the pools end up saying.
            MarketState::Locked => {
                require!(market.live_deposits, ErrorCode::LiveDepositsDisabled);

                let cutoff = market
                    .settle_ts
                    .checked_sub(market.live_cutoff_secs as i64)
                    .ok_or(ErrorCode::MathOverflow)?;
                require!(now < cutoff, ErrorCode::LiveCutoffReached);

                let window = market
                    .settle_ts
                    .checked_sub(market.lock_ts)
                    .ok_or(ErrorCode::MathOverflow)?;
                let remaining = market
                    .settle_ts
                    .checked_sub(now)
                    .ok_or(ErrorCode::MathOverflow)?;

                let multiple = live_multiple_bps(
                    market.fee_bps,
                    market.live_max_multiple_bps,
                    market.live_cap_exp,
                    remaining,
                    window,
                )?;
                Some(live_terms(amount, market.fee_bps, multiple)?)
            }

            MarketState::Settled | MarketState::Voided => {
                return Err(error!(ErrorCode::MarketNotOpen))
            }
        }
    };

    let position = &mut ctx.accounts.position;

    // `init_if_needed` leaves a fresh account zeroed, so a default owner is
    // how a first deposit identifies itself.
    if position.owner == Pubkey::default() {
        position.owner = ctx.accounts.user.key();
        position.market = ctx.accounts.market.key();
        // Fixed for the life of the account: it is part of the address.
        position.side = side;
        position.claimed = false;
        position.bump = ctx.bumps.position;
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
    if let Some(terms) = &live {
        position.live.add(terms)?;
    }

    // The pool carries every deposit; the live totals carry the part of it
    // that arrived after lock, with the same terms the position recorded.
    let market = &mut ctx.accounts.market;
    let pool = market.pool_mut(side);
    *pool = pool.checked_add(amount).ok_or(ErrorCode::MathOverflow)?;
    if let Some(terms) = &live {
        market.live_mut(side).add(terms)?;
    }

    Ok(())
}
