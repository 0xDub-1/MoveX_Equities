//! Phase 2 exit criteria: cradle to grave, plus every edge case that has to
//! behave a specific way.
//!
//! The mock oracle is what makes this possible. A market that takes two
//! trading days in reality runs here in milliseconds, so settlement logic
//! gets exercised on every change instead of once a day at 16:00 ET.
//!
//! The whole file needs a price it can control, so it only exists in a
//! `dev-oracle` build:
//!
//!     anchor build --arch v0 -- --features keeper-oracle
//!     cargo test --features keeper-oracle
#![cfg(feature = "keeper-oracle")]

mod common;
use common::*;

use anchor_lang::prelude::Pubkey;
use movex_equities::state::{MarketState, Side};
use solana_signer::Signer;

/// 400 USDC pot, 1% fee, so 396 USDC distributable.
const ABOVE_STAKE: u64 = 100 * USDC;
const BELOW_STAKE: u64 = 300 * USDC;

#[test]
fn cradle_to_grave() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    let (lock_ts, settle_ts) = (params.lock_ts, params.settle_ts);
    init_market(&mut ctx, params).expect("init_market");

    let (alice, alice_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 1_000 * USDC);

    deposit(&mut ctx, &alice, &alice_ata, Side::Above, ABOVE_STAKE).unwrap();
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, BELOW_STAKE).unwrap();
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 400 * USDC);

    // ---- lock -------------------------------------------------------------
    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).expect("lock");

    let m = market_state(&ctx.svm, &ctx.market);
    assert_eq!(m.state, MarketState::Locked);
    assert_eq!(m.reference_price, REFERENCE_PRICE);
    assert!(m.winning_side.is_none());

    // Deposits are shut once locked.
    assert!(deposit(&mut ctx, &alice, &alice_ata, Side::Above, 10 * USDC).is_err());

    // ---- settle -----------------------------------------------------------
    // 218.29 -> 213.90 is a 2.01% move against a 1.55% strike, so ABOVE wins.
    // The same worked example as the docs.
    warp_to(&mut ctx.svm, settle_ts);
    set_mock_price(&mut ctx, 21_390, None).unwrap();
    settle(&mut ctx).expect("settle");

    let m = market_state(&ctx.svm, &ctx.market);
    assert_eq!(m.state, MarketState::Settled);
    assert_eq!(m.settlement_price, 21_390);
    assert_eq!(m.winning_side, Some(Side::Above));

    // ---- claim ------------------------------------------------------------
    // Alice holds the whole ABOVE pool, so she takes everything distributable:
    // 400 USDC pot, 1% fee, 396 USDC.
    let before = token_balance(&ctx.svm, &alice_ata);
    claim(&mut ctx, &alice, &alice_ata).expect("alice claims");
    assert_eq!(token_balance(&ctx.svm, &alice_ata) - before, 396 * USDC);

    assert!(position_state(&ctx.svm, &position_pda(&ctx, &alice.pubkey())).claimed);

    // The losing side gets nothing, and is told why.
    assert!(claim(&mut ctx, &bob, &bob_ata).is_err());

    // A second claim is refused.
    assert!(claim(&mut ctx, &alice, &alice_ata).is_err());

    // The fee is the only thing left behind.
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 4 * USDC);
}

#[test]
fn an_exact_tie_goes_to_below() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    let (lock_ts, settle_ts) = (params.lock_ts, params.settle_ts);
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, ABOVE_STAKE).unwrap();
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, BELOW_STAKE).unwrap();

    // Reference chosen so a move of exactly 155 bps is representable:
    // 10_000 -> 10_155 is exactly 1.55%.
    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, 10_000, None).unwrap();
    lock(&mut ctx).unwrap();

    warp_to(&mut ctx.svm, settle_ts);
    set_mock_price(&mut ctx, 10_155, None).unwrap();
    settle(&mut ctx).unwrap();

    let m = market_state(&ctx.svm, &ctx.market);
    assert_eq!(
        m.winning_side,
        Some(Side::Below),
        "a move exactly equal to the strike is not 'more than' it"
    );

    // And one basis point further is decisively ABOVE.
    let mut ctx2 = setup();
    let params2 = default_params(&ctx2);
    let (l2, s2) = (params2.lock_ts, params2.settle_ts);
    init_market(&mut ctx2, params2).unwrap();
    let (a2, a2_ata) = funded_wallet(&mut ctx2, 1_000 * USDC);
    let (b2, b2_ata) = funded_wallet(&mut ctx2, 1_000 * USDC);
    deposit(&mut ctx2, &a2, &a2_ata, Side::Above, ABOVE_STAKE).unwrap();
    deposit(&mut ctx2, &b2, &b2_ata, Side::Below, BELOW_STAKE).unwrap();
    warp_to(&mut ctx2.svm, l2);
    set_mock_price(&mut ctx2, 10_000, None).unwrap();
    lock(&mut ctx2).unwrap();
    warp_to(&mut ctx2.svm, s2);
    set_mock_price(&mut ctx2, 10_156, None).unwrap();
    settle(&mut ctx2).unwrap();
    assert_eq!(
        market_state(&ctx2.svm, &ctx2.market).winning_side,
        Some(Side::Above)
    );
}

#[test]
fn an_empty_side_voids_at_lock_and_everyone_refunds() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    let (lock_ts, _) = (params.lock_ts, params.settle_ts);
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, ABOVE_STAKE).unwrap();

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).expect("lock still succeeds, it just voids");

    let m = market_state(&ctx.svm, &ctx.market);
    assert_eq!(m.state, MarketState::Voided);
    assert!(m.winning_side.is_none());

    // Full refund, and no fee taken: a market that did not resolve has not
    // earned one.
    let before = token_balance(&ctx.svm, &alice_ata);
    claim(&mut ctx, &alice, &alice_ata).expect("alice refunds");
    assert_eq!(token_balance(&ctx.svm, &alice_ata) - before, ABOVE_STAKE);
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 0);
}

#[test]
fn payouts_split_a_shared_pool_pro_rata() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    let (lock_ts, settle_ts) = (params.lock_ts, params.settle_ts);
    init_market(&mut ctx, params).unwrap();

    // Two winners on BELOW with a 1:3 split, one loser on ABOVE.
    let (a, a_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    let (b, b_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    let (c, c_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    deposit(&mut ctx, &a, &a_ata, Side::Below, 100 * USDC).unwrap();
    deposit(&mut ctx, &b, &b_ata, Side::Below, 300 * USDC).unwrap();
    deposit(&mut ctx, &c, &c_ata, Side::Above, 600 * USDC).unwrap();

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, 10_000, None).unwrap();
    lock(&mut ctx).unwrap();

    // A 0.5% move, well under the 1.55% strike, so BELOW wins.
    warp_to(&mut ctx.svm, settle_ts);
    set_mock_price(&mut ctx, 10_050, None).unwrap();
    settle(&mut ctx).unwrap();
    assert_eq!(
        market_state(&ctx.svm, &ctx.market).winning_side,
        Some(Side::Below)
    );

    // Pot 1000, fee 1% -> 990 distributable, BELOW pool 400.
    //   a: 100/400 * 990 = 247.5
    //   b: 300/400 * 990 = 742.5
    let a_before = token_balance(&ctx.svm, &a_ata);
    let b_before = token_balance(&ctx.svm, &b_ata);
    claim(&mut ctx, &a, &a_ata).unwrap();
    claim(&mut ctx, &b, &b_ata).unwrap();

    assert_eq!(token_balance(&ctx.svm, &a_ata) - a_before, 247_500_000);
    assert_eq!(token_balance(&ctx.svm, &b_ata) - b_before, 742_500_000);

    // The loser gets nothing.
    assert!(claim(&mut ctx, &c, &c_ata).is_err());

    // Only the fee remains.
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 10 * USDC);
}

#[test]
fn a_stale_price_blocks_the_crank_without_killing_the_market() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    let (lock_ts, _) = (params.lock_ts, params.settle_ts);
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, ABOVE_STAKE).unwrap();
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, BELOW_STAKE).unwrap();

    warp_to(&mut ctx.svm, lock_ts);
    // Published an hour ago, far outside the staleness window.
    set_mock_price(&mut ctx, REFERENCE_PRICE, Some(1)).unwrap();

    let res = lock(&mut ctx);
    assert!(
        res.is_err(),
        "a stale price must not be used. clock={} publish={} state={:?}",
        now(&ctx.svm),
        lock_ts - 3_600,
        market_state(&ctx.svm, &ctx.market).state
    );

    // Crucially the market is untouched, not voided. A transient stale read
    // is retryable; killing the market over it would be far worse for
    // depositors than waiting.
    assert_eq!(
        market_state(&ctx.svm, &ctx.market).state,
        MarketState::Open
    );

    // A fresh price and the same crank succeeds.
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).expect("retry works");
    assert_eq!(
        market_state(&ctx.svm, &ctx.market).state,
        MarketState::Locked
    );
}

#[test]
fn a_dead_feed_can_be_voided_after_the_grace_period() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    let (lock_ts, settle_ts) = (params.lock_ts, params.settle_ts);
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, ABOVE_STAKE).unwrap();
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, BELOW_STAKE).unwrap();

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).unwrap();

    // The feed never comes back.
    warp_to(&mut ctx.svm, settle_ts);
    assert!(void_market(&mut ctx).is_err(), "grace period not elapsed");

    warp_to(&mut ctx.svm, settle_ts + 6 * 60 * 60 + 1);
    void_market(&mut ctx).expect("anyone can release a dead market");
    assert_eq!(
        market_state(&ctx.svm, &ctx.market).state,
        MarketState::Voided
    );

    // Both sides refund in full.
    let a_before = token_balance(&ctx.svm, &alice_ata);
    let b_before = token_balance(&ctx.svm, &bob_ata);
    claim(&mut ctx, &alice, &alice_ata).unwrap();
    claim(&mut ctx, &bob, &bob_ata).unwrap();
    assert_eq!(token_balance(&ctx.svm, &alice_ata) - a_before, ABOVE_STAKE);
    assert_eq!(token_balance(&ctx.svm, &bob_ata) - b_before, BELOW_STAKE);
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 0);
}

#[test]
fn a_settled_market_cannot_be_voided() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    let (lock_ts, settle_ts) = (params.lock_ts, params.settle_ts);
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, ABOVE_STAKE).unwrap();
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, BELOW_STAKE).unwrap();

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, 10_000, None).unwrap();
    lock(&mut ctx).unwrap();
    warp_to(&mut ctx.svm, settle_ts);
    set_mock_price(&mut ctx, 10_500, None).unwrap();
    settle(&mut ctx).unwrap();

    warp_to(&mut ctx.svm, settle_ts + 7 * 60 * 60);
    assert!(
        void_market(&mut ctx).is_err(),
        "a resolved market must not be reopened as voided"
    );
}

#[test]
fn the_crank_respects_its_schedule() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    let (lock_ts, settle_ts) = (params.lock_ts, params.settle_ts);
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, ABOVE_STAKE).unwrap();
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, BELOW_STAKE).unwrap();

    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    assert!(lock(&mut ctx).is_err(), "cannot lock before lock_ts");

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).unwrap();

    set_mock_price(&mut ctx, 21_390, None).unwrap();
    assert!(settle(&mut ctx).is_err(), "cannot settle before settle_ts");

    // And nothing can be settled twice.
    warp_to(&mut ctx.svm, settle_ts);
    set_mock_price(&mut ctx, 21_390, None).unwrap();
    settle(&mut ctx).unwrap();
    set_mock_price(&mut ctx, 30_000, None).unwrap();
    assert!(
        settle(&mut ctx).is_err(),
        "a settled market must not be re-settled at a different price"
    );
}

// ---------------------------------------------------------------------------
// Protocol fee
// ---------------------------------------------------------------------------

/// Runs a market to settlement with ABOVE winning, and returns the two
/// depositors so a test can carry on from there.
fn settled_market(ctx: &mut Ctx) -> ((solana_keypair::Keypair, Pubkey), (solana_keypair::Keypair, Pubkey)) {
    let params = default_params(ctx);
    let (lock_ts, settle_ts) = (params.lock_ts, params.settle_ts);
    init_market(ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(ctx, 1_000 * USDC);
    let (bob, bob_ata) = funded_wallet(ctx, 1_000 * USDC);
    deposit(ctx, &alice, &alice_ata, Side::Above, ABOVE_STAKE).unwrap();
    deposit(ctx, &bob, &bob_ata, Side::Below, BELOW_STAKE).unwrap();

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(ctx, REFERENCE_PRICE, None).unwrap();
    lock(ctx).unwrap();

    warp_to(&mut ctx.svm, settle_ts);
    set_mock_price(ctx, 21_390, None).unwrap();
    settle(ctx).unwrap();

    ((alice, alice_ata), (bob, bob_ata))
}

#[test]
fn the_fee_reaches_the_treasury() {
    let mut ctx = setup();
    let ((alice, alice_ata), _) = settled_market(&mut ctx);

    assert_eq!(token_balance(&ctx.svm, &ctx.treasury_ata), 0);

    collect_fee(&mut ctx).expect("collect");

    // 1% of a 400 USDC pot.
    assert_eq!(token_balance(&ctx.svm, &ctx.treasury_ata), 4 * USDC);
    assert!(market_state(&ctx.svm, &ctx.market).fee_collected);

    // And the winner is still made whole afterwards.
    let before = token_balance(&ctx.svm, &alice_ata);
    claim(&mut ctx, &alice, &alice_ata).expect("alice still claims");
    assert_eq!(token_balance(&ctx.svm, &alice_ata) - before, 396 * USDC);

    // Vault fully drained: nothing stranded, nothing short.
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 0);
}

#[test]
fn the_fee_can_only_be_taken_once() {
    let mut ctx = setup();
    settled_market(&mut ctx);

    collect_fee(&mut ctx).unwrap();
    assert!(
        collect_fee(&mut ctx).is_err(),
        "the fee is a single withdrawal, not a faucet"
    );
    assert_eq!(token_balance(&ctx.svm, &ctx.treasury_ata), 4 * USDC);
}

#[test]
fn collecting_after_claims_works_the_same() {
    let mut ctx = setup();
    let ((alice, alice_ata), _) = settled_market(&mut ctx);

    claim(&mut ctx, &alice, &alice_ata).unwrap();
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 4 * USDC);

    collect_fee(&mut ctx).expect("order does not matter");
    assert_eq!(token_balance(&ctx.svm, &ctx.treasury_ata), 4 * USDC);
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 0);
}

#[test]
fn a_voided_market_yields_no_fee() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    let lock_ts = params.lock_ts;
    init_market(&mut ctx, params).unwrap();

    // Only one side shows up, so the market voids at lock.
    let (alice, alice_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, ABOVE_STAKE).unwrap();
    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).unwrap();

    assert!(
        collect_fee(&mut ctx).is_err(),
        "a market that did not resolve has not earned a fee"
    );
    assert_eq!(token_balance(&ctx.svm, &ctx.treasury_ata), 0);

    // And the depositor still gets every unit back.
    claim(&mut ctx, &alice, &alice_ata).unwrap();
    assert_eq!(token_balance(&ctx.svm, &alice_ata), 1_000 * USDC);
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 0);
}

#[test]
fn the_fee_cannot_be_taken_before_settlement() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    let lock_ts = params.lock_ts;
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, ABOVE_STAKE).unwrap();
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, BELOW_STAKE).unwrap();

    assert!(collect_fee(&mut ctx).is_err(), "market is Open");

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).unwrap();

    assert!(collect_fee(&mut ctx).is_err(), "market is Locked");
    assert_eq!(token_balance(&ctx.svm, &ctx.treasury_ata), 0);
}

#[test]
fn nothing_can_be_claimed_before_a_market_resolves() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    let lock_ts = params.lock_ts;
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, ABOVE_STAKE).unwrap();
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, BELOW_STAKE).unwrap();

    assert!(claim(&mut ctx, &alice, &alice_ata).is_err(), "market is Open");

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).unwrap();

    assert!(
        claim(&mut ctx, &alice, &alice_ata).is_err(),
        "market is Locked"
    );
}
