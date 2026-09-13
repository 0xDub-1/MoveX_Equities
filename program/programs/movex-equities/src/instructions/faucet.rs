//! Self-serve test-token faucet.
//!
//! Markets are denominated in an SPL mint, and on devnet that mint has to
//! come from somewhere. Depending on an external faucet would put evaluation
//! at the mercy of a service we do not control: the roadmap's own worry is
//! that judges may test at 3am on a Sunday, and a dry faucet at that hour
//! means nobody can trade at all.
//!
//! The whole module is gated on `devnet-faucet`, so a production build has no
//! instruction capable of minting the quote asset. A real deployment simply
//! quotes its markets in a mint whose authority is somebody else entirely.
//!
//! Worth stating plainly: this mints a valueless test token. Picking USDX
//! over SOL costs no optionality, because `Market::quote_mint` is a field and
//! wSOL is an SPL token, so a SOL-denominated market later needs no program
//! change at all.

use anchor_lang::prelude::*;
use anchor_spl::token::{mint_to, Mint, MintTo, Token, TokenAccount};

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Faucet, FaucetClaim},
};

// ---------------------------------------------------------------------------
// init_faucet
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitFaucet<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Faucet::INIT_SPACE,
        seeds = [FAUCET_SEED, mint.key().as_ref()],
        bump,
    )]
    pub faucet: Account<'info, Faucet>,

    /// The faucet PDA must already hold mint authority, which is what makes
    /// `faucet_mint` the only path to new supply. Anchor checks it here
    /// rather than trusting the deployer to have wired it correctly.
    #[account(mint::authority = faucet)]
    pub mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
}

pub fn handle_init_faucet(
    ctx: Context<InitFaucet>,
    amount_per_claim: u64,
    cooldown_secs: i64,
) -> Result<()> {
    require!(
        amount_per_claim > 0 && amount_per_claim <= MAX_FAUCET_CLAIM,
        ErrorCode::FaucetAmountInvalid
    );
    require!(cooldown_secs >= 0, ErrorCode::FaucetAmountInvalid);

    let faucet = &mut ctx.accounts.faucet;
    faucet.mint = ctx.accounts.mint.key();
    faucet.authority = ctx.accounts.authority.key();
    faucet.amount_per_claim = amount_per_claim;
    faucet.cooldown_secs = cooldown_secs;
    faucet.bump = ctx.bumps.faucet;

    msg!(
        "faucet open: {} per claim, {}s cooldown",
        amount_per_claim,
        cooldown_secs
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// faucet_mint
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct FaucetMint<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [FAUCET_SEED, mint.key().as_ref()],
        bump = faucet.bump,
        has_one = mint,
    )]
    pub faucet: Account<'info, Faucet>,

    /// Per-user, so one wallet draining the faucet does not affect anyone
    /// else's cooldown.
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + FaucetClaim::INIT_SPACE,
        seeds = [FAUCET_CLAIM_SEED, mint.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub claim: Account<'info, FaucetClaim>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_faucet_mint(ctx: Context<FaucetMint>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let claim = &mut ctx.accounts.claim;

    // `init_if_needed` leaves a fresh account zeroed, so a default user is
    // how a first claim identifies itself. Checking that rather than
    // `last_claim_ts == 0` matters because zero is a real timestamp in a
    // test validator, and treating it as "never claimed" would hand out a
    // free second claim.
    let first_claim = claim.user == Pubkey::default();
    if first_claim {
        claim.faucet = ctx.accounts.faucet.key();
        claim.user = ctx.accounts.user.key();
        claim.total_claimed = 0;
        claim.bump = ctx.bumps.claim;
    } else {
        let ready_at = claim
            .last_claim_ts
            .checked_add(ctx.accounts.faucet.cooldown_secs)
            .ok_or(ErrorCode::MathOverflow)?;
        require!(now >= ready_at, ErrorCode::FaucetCooldownActive);
    }

    let amount = ctx.accounts.faucet.amount_per_claim;

    claim.last_claim_ts = now;
    claim.total_claimed = claim
        .total_claimed
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    let mint_key = ctx.accounts.mint.key();
    let bump = ctx.accounts.faucet.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[FAUCET_SEED, mint_key.as_ref(), &[bump]]];

    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.faucet.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    msg!("faucet minted {}", amount);
    Ok(())
}
