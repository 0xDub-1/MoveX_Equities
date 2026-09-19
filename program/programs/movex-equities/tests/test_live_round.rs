//! The live round: deposits that arrive after lock.
//!
//! One rule governs them. Money that arrives after the reference price is
//! known never dilutes the money that was there before it; beyond that, the
//! pools decide. Each test here is one row of the tables the design was
//! agreed on, run through real transactions to the base unit.
//!
//! Needs a price it can control, so it only exists in a keeper-oracle build:
//!
//!     anchor build --arch v0 -- --features keeper-oracle,devnet-faucet
//!     cargo test --features keeper-oracle,devnet-faucet
#![cfg(feature = "keeper-oracle")]

mod common;
use common::*;

use movex_equities::state::{MarketState, Side};
use solana_signer::Signer;

/// A one-hour market, so the cap numbers match the worked examples exactly:
/// lock an hour from now, settle an hour after that.
fn hour_market(ctx: &Ctx, cutoff_secs: u32) -> movex_equities::instructions::InitMarketParams {
    let mut params = default_params(ctx);
    params.settle_ts = params.lock_ts + 3_600;
    params.live_cutoff_secs = cutoff_secs;
    params
}

/// 218.29 -> 213.90: a 2.01% move, past the 1.55% strike. ABOVE wins.
const SETTLE_ABOVE: u64 = 21_390;
/// 218.29 -> 219.00: a 0.32% move, inside the strike. BELOW wins.
const SETTLE_BELOW: u64 = 21_900;

/// The attack the mechanism exists for. Balanced pre-lock pools, the market
/// decides, and a large deposit lands two minutes before the end on the side
/// that is going to win. It pays its own fee and the pre-lock winner keeps
/// what they would have had.
#[test]
fn a_last_minute_deposit_is_capped_and_pays_its_own_fee() {
    let mut ctx = setup();
    let params = hour_market(&ctx, LIVE_CUTOFF_SECS);
    let (lock_ts, settle_ts) = (params.lock_ts, params.settle_ts);
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    let (sniper, sniper_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, 5_000 * USDC).unwrap();
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, 5_000 * USDC).unwrap();

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).unwrap();

    // 121 seconds left of 3600: f = 336 bps, f^2 = 11 bps, M = 9_911 bps.
    warp_to(&mut ctx.svm, settle_ts - 121);
    deposit(&mut ctx, &sniper, &sniper_ata, Side::Above, 10_000 * USDC).expect("live deposit");

    let m = market_state(&ctx.svm, &ctx.market);
    assert_eq!(m.above_pool, 15_000 * USDC);
    assert_eq!(m.live_above.amount, 10_000 * USDC);
    assert_eq!(m.live_above.floor, 9_900 * USDC);
    assert_eq!(m.live_above.excess, 11 * USDC);
    assert_eq!(m.live_below.amount, 0);

    warp_to(&mut ctx.svm, settle_ts);
    set_mock_price(&mut ctx, SETTLE_ABOVE, None).unwrap();
    settle(&mut ctx).unwrap();
    assert_eq!(market_state(&ctx.svm, &ctx.market).winning_side, Some(Side::Above));

    // Pot 20,000, fee 200, distributable 19,800. Pro rata the sniper would
    // take 13,200; the cap holds it to 9,911 and the rest goes to Alice.
    let a0 = token_balance(&ctx.svm, &alice_ata);
    let s0 = token_balance(&ctx.svm, &sniper_ata);
    claim(&mut ctx, &alice, &alice_ata, Side::Above).unwrap();
    claim(&mut ctx, &sniper, &sniper_ata, Side::Above).unwrap();
    assert_eq!(token_balance(&ctx.svm, &alice_ata) - a0, 9_889 * USDC);
    assert_eq!(token_balance(&ctx.svm, &sniper_ata) - s0, 9_911 * USDC, "loses 89 on 10,000");

    assert!(claim(&mut ctx, &bob, &bob_ata, Side::Below).is_err());
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 200 * USDC, "only the fee remains");
}

/// A side that was empty at lock, filled during the window, and won. Nobody
/// pre-lock to protect, so the pools decide and the live money takes the
/// whole distributable pot.
#[test]
fn live_money_on_an_empty_winning_side_takes_the_pot() {
    let mut ctx = setup();
    let params = hour_market(&ctx, LIVE_CUTOFF_SECS);
    let (lock_ts, settle_ts) = (params.lock_ts, params.settle_ts);
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, 5_000 * USDC).unwrap();

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).expect("an empty side no longer voids at lock");

    warp_to(&mut ctx.svm, settle_ts - 121);
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, 100 * USDC).expect("fills the empty side");

    warp_to(&mut ctx.svm, settle_ts);
    set_mock_price(&mut ctx, SETTLE_BELOW, None).unwrap();
    settle(&mut ctx).unwrap();
    assert_eq!(market_state(&ctx.svm, &ctx.market).state, MarketState::Settled);
    assert_eq!(market_state(&ctx.svm, &ctx.market).winning_side, Some(Side::Below));

    // Pot 5,100, fee 51, distributable 5,049. All of it to the filler.
    let b0 = token_balance(&ctx.svm, &bob_ata);
    claim(&mut ctx, &bob, &bob_ata, Side::Below).unwrap();
    assert_eq!(token_balance(&ctx.svm, &bob_ata) - b0, 5_049 * USDC);
    assert!(claim(&mut ctx, &alice, &alice_ata, Side::Above).is_err());
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 51 * USDC);
}

/// The same fill, but it loses. Then it is simply losing money, and the
/// pre-lock side that was there first takes it.
#[test]
fn live_money_on_an_empty_side_that_loses_pays_the_pre_lock_winners() {
    let mut ctx = setup();
    let params = hour_market(&ctx, LIVE_CUTOFF_SECS);
    let (lock_ts, settle_ts) = (params.lock_ts, params.settle_ts);
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, 5_000 * USDC).unwrap();

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).unwrap();

    warp_to(&mut ctx.svm, settle_ts - 121);
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, 100 * USDC).unwrap();

    warp_to(&mut ctx.svm, settle_ts);
    set_mock_price(&mut ctx, SETTLE_ABOVE, None).unwrap();
    settle(&mut ctx).unwrap();
    assert_eq!(market_state(&ctx.svm, &ctx.market).winning_side, Some(Side::Above));

    // No live money on the winning side, so the old formula: Alice takes the
    // whole 5,049 distributable.
    let a0 = token_balance(&ctx.svm, &alice_ata);
    claim(&mut ctx, &alice, &alice_ata, Side::Above).unwrap();
    assert_eq!(token_balance(&ctx.svm, &alice_ata) - a0, 5_049 * USDC);
    assert!(claim(&mut ctx, &bob, &bob_ata, Side::Below).is_err());
}

/// Two live deposits on an empty winning side, one with a tenth of the
/// window left and one with a fiftieth. Both recover their floor; the
/// profit goes overwhelmingly to the one that committed earlier.
#[test]
fn earlier_live_money_earns_more_of_the_profit() {
    let mut ctx = setup();
    // A sixty second cutoff, so the later of the two deposits is allowed.
    let params = hour_market(&ctx, 60);
    let (lock_ts, settle_ts) = (params.lock_ts, params.settle_ts);
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    let (carol, carol_ata) = funded_wallet(&mut ctx, 1_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, 5_000 * USDC).unwrap();

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).unwrap();

    warp_to(&mut ctx.svm, settle_ts - 360); // M = 10_001: excess 1.01
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, 100 * USDC).unwrap();
    warp_to(&mut ctx.svm, settle_ts - 72); // M = 9_904: excess 0.04
    deposit(&mut ctx, &carol, &carol_ata, Side::Below, 100 * USDC).unwrap();

    let m = market_state(&ctx.svm, &ctx.market);
    assert_eq!(m.live_below.amount, 200 * USDC);
    assert_eq!(m.live_below.floor, 198 * USDC);
    assert_eq!(m.live_below.excess, 1_050_000);

    warp_to(&mut ctx.svm, settle_ts);
    set_mock_price(&mut ctx, SETTLE_BELOW, None).unwrap();
    settle(&mut ctx).unwrap();

    // Pot 5,200, fee 52, distributable 5,148, all to the live group. Floors
    // first (99 each), then 4,950 of profit split 1.01 : 0.04.
    let b0 = token_balance(&ctx.svm, &bob_ata);
    let c0 = token_balance(&ctx.svm, &carol_ata);
    claim(&mut ctx, &bob, &bob_ata, Side::Below).unwrap();
    claim(&mut ctx, &carol, &carol_ata, Side::Below).unwrap();
    assert_eq!(token_balance(&ctx.svm, &bob_ata) - b0, 99 * USDC + 4_761_428_571);
    assert_eq!(token_balance(&ctx.svm, &carol_ata) - c0, 99 * USDC + 188_571_428);

    // Fee plus one base unit of rounding dust.
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 52 * USDC + 1);
}

#[test]
fn live_deposits_close_at_the_cutoff() {
    let mut ctx = setup();
    let params = hour_market(&ctx, LIVE_CUTOFF_SECS);
    let (lock_ts, settle_ts) = (params.lock_ts, params.settle_ts);
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, 100 * USDC).unwrap();
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, 100 * USDC).unwrap();

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).unwrap();

    warp_to(&mut ctx.svm, settle_ts - 121);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, 10 * USDC).expect("one second before the cutoff");

    warp_to(&mut ctx.svm, settle_ts - 120);
    assert!(
        deposit(&mut ctx, &alice, &alice_ata, Side::Above, 10 * USDC).is_err(),
        "at the cutoff the window is closed"
    );
    warp_to(&mut ctx.svm, settle_ts - 1);
    assert!(deposit(&mut ctx, &alice, &alice_ata, Side::Above, 10 * USDC).is_err());
}

#[test]
fn live_deposits_can_be_switched_off_per_market() {
    let mut ctx = setup();
    let mut params = hour_market(&ctx, LIVE_CUTOFF_SECS);
    params.live_deposits = false;
    let lock_ts = params.lock_ts;
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, 100 * USDC).unwrap();
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, 100 * USDC).unwrap();

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).unwrap();

    assert!(
        deposit(&mut ctx, &alice, &alice_ata, Side::Above, 10 * USDC).is_err(),
        "this market behaves exactly as one without a live round"
    );
}

/// Holding both sides across the lock. The pre-lock position wins and pays
/// as before; the live position on the other side simply loses.
#[test]
fn a_user_may_hold_both_sides_across_the_lock() {
    let mut ctx = setup();
    let params = hour_market(&ctx, LIVE_CUTOFF_SECS);
    let (lock_ts, settle_ts) = (params.lock_ts, params.settle_ts);
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, 1_000 * USDC).unwrap();
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, 1_000 * USDC).unwrap();

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).unwrap();

    // Alice hedges the other way, just after lock: cap 2x, but it loses.
    warp_to(&mut ctx.svm, lock_ts + 1);
    deposit(&mut ctx, &alice, &alice_ata, Side::Below, 1_000 * USDC).expect("other side, live");

    let below = position_state(&ctx.svm, &position_pda(&ctx, &alice.pubkey(), Side::Below));
    assert_eq!(below.live.amount, 1_000 * USDC);

    warp_to(&mut ctx.svm, settle_ts);
    set_mock_price(&mut ctx, SETTLE_ABOVE, None).unwrap();
    settle(&mut ctx).unwrap();

    // Pot 3,000, fee 30, distributable 2,970, no live money on ABOVE, so
    // Alice's ABOVE position takes all of it. Her BELOW position is a loser.
    let a0 = token_balance(&ctx.svm, &alice_ata);
    claim(&mut ctx, &alice, &alice_ata, Side::Above).unwrap();
    assert_eq!(token_balance(&ctx.svm, &alice_ata) - a0, 2_970 * USDC);
    assert!(claim(&mut ctx, &alice, &alice_ata, Side::Below).is_err());
    assert!(claim(&mut ctx, &bob, &bob_ata, Side::Below).is_err());
}

/// A void refunds live money too, in full, with no fee.
#[test]
fn a_void_refunds_live_money_in_full() {
    let mut ctx = setup();
    let params = hour_market(&ctx, LIVE_CUTOFF_SECS);
    let (lock_ts, settle_ts) = (params.lock_ts, params.settle_ts);
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    let (carol, carol_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, 100 * USDC).unwrap();
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, 300 * USDC).unwrap();

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).unwrap();

    warp_to(&mut ctx.svm, settle_ts - 1_800);
    deposit(&mut ctx, &carol, &carol_ata, Side::Above, 50 * USDC).unwrap();
    // Alice tops up live as well, so one position carries both kinds.
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, 25 * USDC).unwrap();

    // The feed dies.
    warp_to(&mut ctx.svm, settle_ts + 6 * 60 * 60 + 1);
    void_market(&mut ctx).unwrap();

    for (who, ata, side, stake) in [
        (&alice, &alice_ata, Side::Above, 125 * USDC),
        (&bob, &bob_ata, Side::Below, 300 * USDC),
        (&carol, &carol_ata, Side::Above, 50 * USDC),
    ] {
        let before = token_balance(&ctx.svm, ata);
        claim(&mut ctx, who, ata, side).unwrap();
        assert_eq!(token_balance(&ctx.svm, ata) - before, stake);
    }
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 0);
}

/// Anyone can pay a winner out, and the money can only land in the winner's
/// own associated token account, created on the spot if it has to be.
#[test]
fn a_stranger_can_pay_a_winner_but_only_to_the_winner() {
    let mut ctx = setup();
    let params = hour_market(&ctx, LIVE_CUTOFF_SECS);
    let (lock_ts, settle_ts) = (params.lock_ts, params.settle_ts);
    init_market(&mut ctx, params).unwrap();

    let (alice, alice_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx, 10_000 * USDC);
    deposit(&mut ctx, &alice, &alice_ata, Side::Above, 100 * USDC).unwrap();
    deposit(&mut ctx, &bob, &bob_ata, Side::Below, 300 * USDC).unwrap();

    warp_to(&mut ctx.svm, lock_ts);
    set_mock_price(&mut ctx, REFERENCE_PRICE, None).unwrap();
    lock(&mut ctx).unwrap();
    warp_to(&mut ctx.svm, settle_ts);
    set_mock_price(&mut ctx, SETTLE_ABOVE, None).unwrap();
    settle(&mut ctx).unwrap();

    // Alice's associated token account does not exist yet: the harness gave
    // her a plain one. The payout creates it.
    let ata = owner_ata(&ctx, &alice.pubkey());
    assert!(ctx.svm.get_account(&ata).is_none());

    claim_for_owner(&mut ctx, &alice.pubkey(), Side::Above).expect("a stranger pays alice");
    assert_eq!(token_balance(&ctx.svm, &ata), 396 * USDC);
    assert!(position_state(&ctx.svm, &position_pda(&ctx, &alice.pubkey(), Side::Above)).claimed);

    // Spent: neither the stranger nor Alice can claim it again.
    assert!(claim_for_owner(&mut ctx, &alice.pubkey(), Side::Above).is_err());
    assert!(claim(&mut ctx, &alice, &alice_ata, Side::Above).is_err());

    // A loser cannot be paid by anyone.
    assert!(claim_for_owner(&mut ctx, &bob.pubkey(), Side::Below).is_err());
    assert_eq!(token_balance(&ctx.svm, &ctx.vault), 4 * USDC);
}
