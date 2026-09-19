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

    let alice_pos = position_state(&ctx.svm, &position_pda(&ctx, &alice.pubkey(), Side::Above));
    assert_eq!(alice_pos.owner, alice.pubkey());
    assert_eq!(alice_pos.side, Side::Above);
    assert_eq!(alice_pos.amount, 100 * USDC);
    assert_eq!(alice_pos.live.amount, 0, "nothing live before lock");
    assert!(!alice_pos.claimed);

    // A second deposit on the same side accumulates.
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, 50 * USDC).expect("alice tops up");
    assert_eq!(
        position_state(&ctx.svm, &position_pda(&ctx, &alice.pubkey(), Side::Above)).amount,
        150 * USDC
    );
    assert_eq!(market_state(&ctx.svm, &ctx.market).above_pool, 150 * USDC);

    // Partial withdrawal before lock.
    withdraw(&mut ctx, &alice, &alice_ata, Side::Above, 40 * USDC).expect("alice withdraws");

    let m = market_state(&ctx.svm, &ctx.market);
    assert_eq!(m.above_pool, 110 * USDC);
    assert_eq!(m.below_pool, 300 * USDC);
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 410 * USDC);
    assert_eq!(token_balance(&ctx.svm, &alice_ata), 890 * USDC);
    assert_eq!(
        position_state(&ctx.svm, &position_pda(&ctx, &alice.pubkey(), Side::Above)).amount,
        110 * USDC
    );

    // Nothing leaked: the vault holds exactly the two pools.
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), m.pot().unwrap());
}

/// The side is part of the position's address, so a full withdrawal leaves
/// an empty ABOVE position behind and a BELOW deposit opens a second one.
/// Neither can see the other.
#[test]
fn a_full_withdrawal_and_a_deposit_on_the_other_side_are_two_positions() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    init_market(&mut ctx, params).unwrap();
    let (alice, ata) = funded_wallet(&mut ctx, 1_000 * USDC);

    deposit(&mut ctx, &alice, &ata, Side::Above, 100 * USDC).unwrap();
    withdraw(&mut ctx, &alice, &ata, Side::Above, 100 * USDC).unwrap();

    let m = market_state(&ctx.svm, &ctx.market);
    assert_eq!(m.above_pool, 0);
    assert_eq!(token_balance(&ctx.svm, &ata), 1_000 * USDC);

    deposit(&mut ctx, &alice, &ata, Side::Below, 100 * USDC).expect("the other side");

    let m = market_state(&ctx.svm, &ctx.market);
    assert_eq!(m.above_pool, 0);
    assert_eq!(m.below_pool, 100 * USDC);

    let above = position_state(&ctx.svm, &position_pda(&ctx, &alice.pubkey(), Side::Above));
    let below = position_state(&ctx.svm, &position_pda(&ctx, &alice.pubkey(), Side::Below));
    assert_eq!((above.side, above.amount), (Side::Above, 0));
    assert_eq!((below.side, below.amount), (Side::Below, 100 * USDC));
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

/// The live parameters are frozen into every market, so a market cannot be
/// created carrying values it could not run on.
#[test]
fn rejects_live_parameters_outside_their_bounds() {
    let mut ctx = setup();

    let mut params = default_params(&ctx);
    params.live_max_multiple_bps = 9_899; // less than the deposit minus fee
    assert!(init_market(&mut ctx, params).is_err(), "cap below 1 - fee");

    let mut params = default_params(&ctx);
    params.live_max_multiple_bps = 50_001;
    assert!(init_market(&mut ctx, params).is_err(), "cap above the ceiling");

    let mut params = default_params(&ctx);
    params.live_cap_exp = 4;
    assert!(init_market(&mut ctx, params).is_err(), "exponent too steep");

    let mut params = default_params(&ctx);
    params.live_cutoff_secs = 59;
    assert!(init_market(&mut ctx, params).is_err(), "cutoff under the floor");

    let mut params = default_params(&ctx);
    params.live_cutoff_secs = (params.settle_ts - params.lock_ts) as u32;
    assert!(init_market(&mut ctx, params).is_err(), "cutoff swallows the window");

    // A flat cap and a switched-off live round are both fine.
    let mut params = default_params(&ctx);
    params.live_cap_exp = 0;
    params.live_deposits = false;
    assert!(init_market(&mut ctx, params).is_ok());
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

/// Holding both sides is allowed. It costs the fee on both and harms nobody,
/// and it is what a market maker, a vault, or someone hedging their own
/// position needs.
#[test]
fn allows_holding_both_sides_at_once() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    init_market(&mut ctx, params).unwrap();
    let (alice, ata) = funded_wallet(&mut ctx, 1_000 * USDC);

    deposit(&mut ctx, &alice, &ata, Side::Above, 100 * USDC).unwrap();
    deposit(&mut ctx, &alice, &ata, Side::Below, 250 * USDC).expect("both sides");

    let m = market_state(&ctx.svm, &ctx.market);
    assert_eq!(m.above_pool, 100 * USDC);
    assert_eq!(m.below_pool, 250 * USDC);

    let above = position_state(&ctx.svm, &position_pda(&ctx, &alice.pubkey(), Side::Above));
    let below = position_state(&ctx.svm, &position_pda(&ctx, &alice.pubkey(), Side::Below));
    assert_eq!(above.amount, 100 * USDC);
    assert_eq!(below.amount, 250 * USDC);

    // Each side withdraws on its own.
    withdraw(&mut ctx, &alice, &ata, Side::Below, 50 * USDC).unwrap();
    assert_eq!(market_state(&ctx.svm, &ctx.market).below_pool, 200 * USDC);
    assert_eq!(market_state(&ctx.svm, &ctx.market).above_pool, 100 * USDC);
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
    assert!(withdraw(&mut ctx, &alice, &alice_ata, Side::Above, 101 * USDC).is_err());
    assert!(withdraw(&mut ctx, &alice, &alice_ata, Side::Above, 0).is_err());
    assert!(withdraw(&mut ctx, &alice, &alice_ata, Side::Above, 100 * USDC).is_ok());
}

/// Past the lock time but before the crank has locked, the market is in
/// limbo: the reference is not yet recorded, so full-weight money must not
/// get in, and neither may the live kind, which needs a reference to be
/// capped against.
#[test]
fn rejects_deposits_between_the_lock_time_and_the_lock() {
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
        withdraw(&mut ctx, &alice, &ata, Side::Above, 50 * USDC).is_err(),
        "the escape hatch closes with the deposit window"
    );
}
