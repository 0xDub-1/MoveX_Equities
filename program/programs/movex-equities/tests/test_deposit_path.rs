//! Phase 1 exit criteria.
//!
//! Creates a market, has two wallets deposit on opposite sides, has one of
//! them withdraw before lock, and asserts every balance and pool total to the
//! base unit. Then the paths that must fail, fail.

mod common;
use common::*;

use movex_equities::state::{MarketState, Side};
use solana_signer::Signer;

#[test]
fn deposit_path_cradle_to_withdrawal() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    init_market(&mut ctx, params).expect("init_market");

    let m = market_state(&ctx.svm, &ctx.market);
    assert_eq!(m.state, MarketState::Open);
    assert_eq!(m.strike_bps, NVDA_FAIR_STRIKE);
    assert_eq!(m.samples_bps, NVDA_SAMPLES);
    assert_eq!(m.above_pool, 0);
    assert_eq!(m.below_pool, 0);
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 0);

    let (alice, alice_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 1_000 * USDC);

    // Opposite sides, unequal size, so the pools cannot be confused.
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, 100 * USDC).expect("alice deposit");
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, 300 * USDC).expect("bob deposit");

    let m = market_state(&ctx.svm, &ctx.market);
    assert_eq!(m.above_pool, 100 * USDC);
    assert_eq!(m.below_pool, 300 * USDC);
    assert_eq!(m.pot().unwrap(), 400 * USDC);

    // Every deposited unit is in the vault, and nowhere else.
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 400 * USDC);
    assert_eq!(token_balance(&ctx.svm, &alice_ata), 900 * USDC);
    assert_eq!(token_balance(&ctx.svm, &bob_ata), 700 * USDC);

    let alice_pos = position_state(&ctx.svm, &position_pda(&ctx, &alice.pubkey()));
    assert_eq!(alice_pos.owner, alice.pubkey());
    assert_eq!(alice_pos.side, Side::Above);
    assert_eq!(alice_pos.amount, 100 * USDC);
    assert!(!alice_pos.claimed);

    // A second deposit on the same side accumulates.
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, 50 * USDC).expect("alice tops up");
    assert_eq!(
        position_state(&ctx.svm, &position_pda(&ctx, &alice.pubkey())).amount,
        150 * USDC
    );
    assert_eq!(market_state(&ctx.svm, &ctx.market).above_pool, 150 * USDC);

    // Partial withdrawal before lock.
    withdraw(&mut ctx, &alice, &alice_ata, 40 * USDC).expect("alice withdraws");

    let m = market_state(&ctx.svm, &ctx.market);
    assert_eq!(m.above_pool, 110 * USDC);
    assert_eq!(m.below_pool, 300 * USDC);
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 410 * USDC);
    assert_eq!(token_balance(&ctx.svm, &alice_ata), 890 * USDC);
    assert_eq!(
        position_state(&ctx.svm, &position_pda(&ctx, &alice.pubkey())).amount,
        110 * USDC
    );

    // Nothing leaked: the vault holds exactly the two pools.
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), m.pot().unwrap());
}

#[test]
fn full_withdrawal_frees_the_side() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    init_market(&mut ctx, params).unwrap();
    let (alice, ata) = funded_wallet(&mut ctx, 1_000 * USDC);

    deposit(&mut ctx, &alice, &ata, Side::Above, 100 * USDC).unwrap();
    withdraw(&mut ctx, &alice, &ata, 100 * USDC).unwrap();

    let m = market_state(&ctx.svm, &ctx.market);
    assert_eq!(m.above_pool, 0);
    assert_eq!(token_balance(&ctx.svm, &ata), 1_000 * USDC);

    // Balance is back to zero, so changing mind about the side is allowed.
    deposit(&mut ctx, &alice, &ata, Side::Below, 100 * USDC).expect("switch sides when flat");

    let m = market_state(&ctx.svm, &ctx.market);
    assert_eq!(m.above_pool, 0);
    assert_eq!(m.below_pool, 100 * USDC);
    assert_eq!(
        position_state(&ctx.svm, &position_pda(&ctx, &alice.pubkey())).side,
        Side::Below
    );
}

// ---------------------------------------------------------------------------
// What must not be allowed
// ---------------------------------------------------------------------------

#[test]
fn rejects_a_strike_its_own_samples_do_not_produce() {
    let mut ctx = setup();
    let mut params = default_params(&ctx);

    // One basis point off the percentile of the series it ships with.
    params.strike_bps = NVDA_FAIR_STRIKE + 1;
    assert!(
        init_market(&mut ctx, params.clone()).is_err(),
        "a strike the samples do not produce must not create a market"
    );

    // The real P25 for this series, but this market is declared Fair.
    params.strike_bps = 89;
    assert!(init_market(&mut ctx, params).is_err());
}

#[test]
fn rejects_an_unsorted_sample_series() {
    let mut ctx = setup();
    let mut params = default_params(&ctx);
    params.samples_bps.swap(0, 19);
    assert!(init_market(&mut ctx, params).is_err());
}

#[test]
fn rejects_a_fee_above_the_ceiling() {
    let mut ctx = setup();
    let mut params = default_params(&ctx);
    params.fee_bps = 5_001;
    assert!(init_market(&mut ctx, params).is_err());
}

#[test]
fn rejects_settle_before_lock() {
    let mut ctx = setup();
    let mut params = default_params(&ctx);
    params.settle_ts = params.lock_ts - 1;
    assert!(init_market(&mut ctx, params).is_err());
}

#[test]
fn rejects_dust_deposits() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    init_market(&mut ctx, params).unwrap();
    let (alice, ata) = funded_wallet(&mut ctx, 1_000 * USDC);

    assert!(deposit(&mut ctx, &alice, &ata, Side::Above, 1).is_err());
    assert!(deposit(&mut ctx, &alice, &ata, Side::Above, USDC - 1).is_err());
    assert!(deposit(&mut ctx, &alice, &ata, Side::Above, USDC).is_ok());
}

#[test]
fn rejects_holding_both_sides_at_once() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    init_market(&mut ctx, params).unwrap();
    let (alice, ata) = funded_wallet(&mut ctx, 1_000 * USDC);

    deposit(&mut ctx, &alice, &ata, Side::Above, 100 * USDC).unwrap();
    assert!(
        deposit(&mut ctx, &alice, &ata, Side::Below, 100 * USDC).is_err(),
        "a position holds one side while it has a balance"
    );
}

#[test]
fn rejects_withdrawing_more_than_deposited() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    init_market(&mut ctx, params).unwrap();
    let (alice, alice_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 1_000 * USDC);

    deposit(&mut ctx, &alice, &alice_ata, Side::Above, 100 * USDC).unwrap();
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, 300 * USDC).unwrap();

    // The vault holds 400, but Alice's claim on it is 100.
    assert!(withdraw(&mut ctx, &alice, &alice_ata, 101 * USDC).is_err());
    assert!(withdraw(&mut ctx, &alice, &alice_ata, 0).is_err());
    assert!(withdraw(&mut ctx, &alice, &alice_ata, 100 * USDC).is_ok());
}

#[test]
fn rejects_deposits_after_the_lock_time() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    let lock_ts = params.lock_ts;
    init_market(&mut ctx, params).unwrap();
    let (alice, ata) = funded_wallet(&mut ctx, 1_000 * USDC);

    deposit(&mut ctx, &alice, &ata, Side::Above, 100 * USDC).expect("before lock");

    // Jump the clock past the deposit window.
    warp_to(&mut ctx.svm, lock_ts + 1);

    assert!(deposit(&mut ctx, &alice, &ata, Side::Above, 100 * USDC).is_err());
    assert!(
        withdraw(&mut ctx, &alice, &ata, 50 * USDC).is_err(),
        "the escape hatch closes with the deposit window"
    );
}
