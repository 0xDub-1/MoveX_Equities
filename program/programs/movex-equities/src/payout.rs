//! Settlement arithmetic.
//!
//! Isolated and pure so it can be checked against numbers worked out by hand
//! rather than only through a transaction.
//!
//! Two properties matter more than elegance here:
//!
//! - **Nothing overflows.** Every intermediate runs in u128. A pot of
//!   u64::MAX multiplied by a share would wrap long before the division
//!   brought it back down, and a payout is not where you want to discover
//!   that.
//! - **Nothing over-pays.** Integer division truncates, so the sum of all
//!   payouts is always at or just under the distributable amount. The few
//!   base units left behind are dust in the vault, which is the safe side to
//!   err on: the alternative is a last claimant finding an empty vault.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;

/// Protocol fee on the pot, in base units.
pub fn fee_amount(pot: u64, fee_bps: u16) -> Result<u64> {
    let fee = (pot as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(ErrorCode::MathOverflow)?
        / 10_000;

    u64::try_from(fee).map_err(|_| error!(ErrorCode::MathOverflow))
}

/// What the winning side splits, after the fee.
pub fn distributable(pot: u64, fee_bps: u16) -> Result<u64> {
    pot.checked_sub(fee_amount(pot, fee_bps)?)
        .ok_or(error!(ErrorCode::MathOverflow))
}

/// One winner's pro-rata share.
///
/// ```text
///   payout = amount * distributable / winning_pool
/// ```
pub fn payout(amount: u64, distributable: u64, winning_pool: u64) -> Result<u64> {
    require!(winning_pool > 0, ErrorCode::NothingToClaim);
    require!(amount <= winning_pool, ErrorCode::MathOverflow);

    let share = (amount as u128)
        .checked_mul(distributable as u128)
        .ok_or(ErrorCode::MathOverflow)?
        / (winning_pool as u128);

    u64::try_from(share).map_err(|_| error!(ErrorCode::MathOverflow))
}

// ---------------------------------------------------------------------------
// Live round
// ---------------------------------------------------------------------------
//
// Deposits that arrive after lock. One rule governs them: money that arrives
// after the reference price is known never dilutes the money that was there
// before it. Beyond that, the pools decide.
//
// Each live deposit is recorded as two integers. `floor` is the least it can
// ever be paid back if its side wins, `amount * (1 - fee)`, so a deposit in
// the last second pays its own fee and touches nobody else. `excess` is how
// much more its cap allows, and that is what decays with the time left in
// the window. Both are accumulated on the pool exactly as computed here, so
// every division below is by a sum of the very terms it distributes and the
// payouts of a group can never add up to more than the group was given.

/// Basis points in a whole.
const BPS: u128 = 10_000;

// The three integers a side's live deposits reduce to, and the same three
// for one position's share of them. Defined with the accounts that carry
// them; the arithmetic below is the only thing that reads them.
pub use crate::state::LiveTotals;

/// The maximum multiple a live deposit may be paid, in basis points, given
/// how much of the window is left.
///
/// ```text
///   f = remaining / window                           0 at settle, 1 at lock
///   M = (1 - fee) + (max - (1 - fee)) * f^k
/// ```
///
/// `remaining` is clamped to the window, so a call before lock reads as the
/// full window and a call after settle as none of it. `k` of zero is a flat
/// cap at `max`; higher values hold the cap near `max` early and drive it to
/// `1 - fee` sooner.
pub fn live_multiple_bps(
    fee_bps: u16,
    max_multiple_bps: u16,
    cap_exp: u8,
    remaining_secs: i64,
    window_secs: i64,
) -> Result<u32> {
    require!(window_secs > 0, ErrorCode::SettleBeforeLock);
    require!(cap_exp <= crate::constants::MAX_LIVE_CAP_EXP, ErrorCode::LiveCapExpInvalid);

    let base = BPS - fee_bps as u128;
    let max = max_multiple_bps as u128;
    require!(max >= base, ErrorCode::LiveMaxMultipleInvalid);

    let remaining = remaining_secs.clamp(0, window_secs) as u128;
    let f_bps = remaining * BPS / window_secs as u128;

    // f^k, kept in basis points by dividing after every multiply. The
    // largest intermediate is 10_000 * 10_000, nowhere near u128.
    let mut f_pow = BPS;
    for _ in 0..cap_exp {
        f_pow = f_pow * f_bps / BPS;
    }

    let multiple = base + (max - base) * f_pow / BPS;
    u32::try_from(multiple).map_err(|_| error!(ErrorCode::MathOverflow))
}

/// What a live deposit is recorded as: its floor and its excess.
///
/// The cap itself is `floor + excess`. Split this way rather than stored as
/// the cap because the two parts are paid from two different pools of money
/// at claim time, and each has to be summed exactly.
pub fn live_terms(amount: u64, fee_bps: u16, multiple_bps: u32) -> Result<LiveTotals> {
    let base = BPS - fee_bps as u128;
    require!(multiple_bps as u128 >= base, ErrorCode::LiveMaxMultipleInvalid);

    let floor = (amount as u128) * base / BPS;
    let cap = (amount as u128)
        .checked_mul(multiple_bps as u128)
        .ok_or(ErrorCode::MathOverflow)?
        / BPS;

    Ok(LiveTotals {
        amount,
        floor: u64::try_from(floor).map_err(|_| error!(ErrorCode::MathOverflow))?,
        excess: u64::try_from(cap - floor).map_err(|_| error!(ErrorCode::MathOverflow))?,
    })
}

/// What the winning side's live deposits are paid as a group.
///
/// Three cases, in order:
///
/// - No live money: nothing, and the pre-lock winners take everything, which
///   is the market as it was before live deposits existed.
/// - Live money but no pre-lock money on the winning side: the pools decide.
///   There is nobody the cap would be protecting, and the losers' money is
///   theirs to lose.
/// - Both: the live group takes its pro-rata share, but never more than its
///   cap. Whatever the cap holds back goes to the pre-lock winners, who are
///   the ones it would otherwise have diluted.
pub fn live_group(distributable: u64, winning_pool: u64, live: &LiveTotals) -> Result<u64> {
    if live.amount == 0 {
        return Ok(0);
    }
    let pre_lock = winning_pool
        .checked_sub(live.amount)
        .ok_or(error!(ErrorCode::MathOverflow))?;
    if pre_lock == 0 {
        return Ok(distributable);
    }

    let raw = (distributable as u128)
        .checked_mul(live.amount as u128)
        .ok_or(ErrorCode::MathOverflow)?
        / (winning_pool as u128);
    let cap = live.cap()? as u128;

    u64::try_from(raw.min(cap)).map_err(|_| error!(ErrorCode::MathOverflow))
}

/// One live position's share of what its group was paid.
///
/// Two layers. First every position recovers its floor, pro rata, which the
/// group is always able to fund. Then the rest, the group's profit, goes by
/// excess, which is larger for money that arrived with more of the window
/// left. If nobody in the group has any excess, which means all of it landed
/// at the very end, the profit goes pro rata by amount instead.
///
/// Each layer divides by a pool total that was accumulated from the same
/// per-position terms it is now distributing, so each layer's payouts sum to
/// at most the layer.
pub fn payout_live(position: &LiveTotals, group: u64, pool: &LiveTotals) -> Result<u64> {
    require!(position.amount <= pool.amount, ErrorCode::MathOverflow);
    require!(position.floor <= pool.floor, ErrorCode::MathOverflow);
    require!(position.excess <= pool.excess, ErrorCode::MathOverflow);

    let floor_layer = group.min(pool.floor) as u128;
    let excess_layer = group as u128 - floor_layer;

    let first = if pool.floor > 0 {
        (position.floor as u128) * floor_layer / (pool.floor as u128)
    } else {
        0
    };

    let second = if pool.excess > 0 {
        (position.excess as u128)
            .checked_mul(excess_layer)
            .ok_or(ErrorCode::MathOverflow)?
            / (pool.excess as u128)
    } else if pool.amount > 0 {
        (position.amount as u128)
            .checked_mul(excess_layer)
            .ok_or(ErrorCode::MathOverflow)?
            / (pool.amount as u128)
    } else {
        0
    };

    u64::try_from(first + second).map_err(|_| error!(ErrorCode::MathOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;

    const USDC: u64 = 1_000_000;

    // -- live round -------------------------------------------------------

    const FEE: u16 = 100;
    const MAX_2X: u16 = 20_000;
    const HOUR: i64 = 3_600;

    /// A live deposit as the program would record it.
    fn live(amount: u64, exp: u8, remaining: i64) -> LiveTotals {
        let m = live_multiple_bps(FEE, MAX_2X, exp, remaining, HOUR).unwrap();
        live_terms(amount, FEE, m).unwrap()
    }

    fn add(a: LiveTotals, b: LiveTotals) -> LiveTotals {
        LiveTotals {
            amount: a.amount + b.amount,
            floor: a.floor + b.floor,
            excess: a.excess + b.excess,
        }
    }

    #[test]
    fn the_cap_runs_from_max_at_lock_to_the_fee_floor_at_settle() {
        assert_eq!(live_multiple_bps(FEE, MAX_2X, 2, HOUR, HOUR).unwrap(), 20_000);
        assert_eq!(live_multiple_bps(FEE, MAX_2X, 2, 0, HOUR).unwrap(), 9_900);
        // Before lock reads as the full window, after settle as none of it.
        assert_eq!(live_multiple_bps(FEE, MAX_2X, 2, HOUR * 2, HOUR).unwrap(), 20_000);
        assert_eq!(live_multiple_bps(FEE, MAX_2X, 2, -5, HOUR).unwrap(), 9_900);
    }

    /// The table the design was agreed on. Half a window left, 2x max.
    #[test]
    fn the_exponent_shapes_the_decay() {
        let half = HOUR / 2;
        assert_eq!(live_multiple_bps(FEE, MAX_2X, 0, half, HOUR).unwrap(), 20_000);
        assert_eq!(live_multiple_bps(FEE, MAX_2X, 1, half, HOUR).unwrap(), 14_950);
        assert_eq!(live_multiple_bps(FEE, MAX_2X, 2, half, HOUR).unwrap(), 12_425);
        assert_eq!(live_multiple_bps(FEE, MAX_2X, 3, half, HOUR).unwrap(), 11_162);
    }

    #[test]
    fn a_deposit_splits_into_a_floor_and_an_excess() {
        // 10,000 USDC two minutes before the end of an hour, k = 2.
        // f = 333 bps, f^2 = 11 bps, M = 9_900 + 10_100 * 11 / 10_000 = 9_911.
        let t = live(10_000 * USDC, 2, 120);
        assert_eq!(t.floor, 9_900 * USDC);
        assert_eq!(t.excess, 11 * USDC);
        assert_eq!(t.cap().unwrap(), 9_911 * USDC);
    }

    /// The attack the whole mechanism exists for. Balanced pools, the
    /// market decides, and a large deposit lands two minutes before the end
    /// on the side that is going to win.
    #[test]
    fn a_last_minute_deposit_pays_its_fee_and_touches_nobody() {
        let pre_lock_yes = 5_000 * USDC;
        let no = 5_000 * USDC;
        let snipe = live(10_000 * USDC, 2, 120);

        let pot = pre_lock_yes + no + snipe.amount;
        let dist = distributable(pot, FEE).unwrap();
        assert_eq!(dist, 19_800 * USDC);

        let winning_pool = pre_lock_yes + snipe.amount;
        let group = live_group(dist, winning_pool, &snipe).unwrap();
        assert_eq!(group, 9_911 * USDC, "capped, not the 13,200 pro rata");

        // The sniper gets its cap and loses 89 on 10,000.
        assert_eq!(payout_live(&snipe, group, &snipe).unwrap(), 9_911 * USDC);
        // The pre-lock winner keeps 9,889 against 9,900 with no sniper at all.
        let early = payout(pre_lock_yes, dist - group, pre_lock_yes).unwrap();
        assert_eq!(early, 9_889 * USDC);
        assert_eq!(early + group + fee_amount(pot, FEE).unwrap(), pot);
    }

    #[test]
    fn a_mid_window_deposit_is_capped_at_its_multiple() {
        let pre_lock_yes = 5_000 * USDC;
        let no = 5_000 * USDC;
        let mid = live(10_000 * USDC, 2, HOUR / 2);
        assert_eq!(mid.cap().unwrap(), 12_425 * USDC);

        let dist = distributable(pre_lock_yes + no + mid.amount, FEE).unwrap();
        let group = live_group(dist, pre_lock_yes + mid.amount, &mid).unwrap();
        assert_eq!(group, 12_425 * USDC);
        assert_eq!(payout(pre_lock_yes, dist - group, pre_lock_yes).unwrap(), 7_375 * USDC);
    }

    #[test]
    fn with_no_live_money_the_old_formula_is_untouched() {
        let dist = distributable(10_000 * USDC, FEE).unwrap();
        let none = LiveTotals::default();
        assert_eq!(live_group(dist, 5_000 * USDC, &none).unwrap(), 0);
        // Which leaves the pre-lock winners exactly today's payout.
        assert_eq!(payout(1_000 * USDC, dist, 5_000 * USDC).unwrap(), 1_980 * USDC);
    }

    /// The side was empty at lock and filled during the window. Nobody
    /// pre-lock to protect, so the cap does not apply and the pools rule.
    #[test]
    fn with_no_pre_lock_winners_the_pools_decide() {
        let losers = 5_000 * USDC;
        let filler = live(100 * USDC, 2, 120);
        let dist = distributable(losers + filler.amount, FEE).unwrap();

        let group = live_group(dist, filler.amount, &filler).unwrap();
        assert_eq!(group, dist);
        assert_eq!(payout_live(&filler, group, &filler).unwrap(), dist);
    }

    /// Two live deposits on an empty winning side: one with a tenth of the
    /// window left, one with a fiftieth. The profit goes overwhelmingly to
    /// the one that committed earlier.
    #[test]
    fn within_the_live_group_earlier_money_earns_the_profit() {
        let losers = 5_000 * USDC;
        let early = live(100 * USDC, 2, 360); // M = 10_001
        let late = live(100 * USDC, 2, 72); // M = 9_904
        assert_eq!(early.excess, 1_010_000);
        assert_eq!(late.excess, 40_000);

        let pool = add(early, late);
        let dist = distributable(losers + pool.amount, FEE).unwrap();
        let group = live_group(dist, pool.amount, &pool).unwrap();
        assert_eq!(group, dist);

        let pay_early = payout_live(&early, group, &pool).unwrap();
        let pay_late = payout_live(&late, group, &pool).unwrap();

        // Both recover their floor of 99, then split 4,950 of profit by
        // excess: 1.01 against 0.04.
        assert_eq!(pay_early, 99 * USDC + 4_761_428_571);
        assert_eq!(pay_late, 99 * USDC + 188_571_428);
        assert!(pay_early + pay_late <= group);
        assert!(group - (pay_early + pay_late) < 2, "only dust left behind");
    }

    /// Everyone arrived at the very end, so nobody holds any excess. The
    /// profit still has to go somewhere, and it goes by amount.
    #[test]
    fn with_no_excess_at_all_the_profit_goes_by_amount() {
        let losers = 3_000 * USDC;
        let a = live(100 * USDC, 2, 0);
        let b = live(300 * USDC, 2, 0);
        assert_eq!(a.excess + b.excess, 0);

        let pool = add(a, b);
        let dist = distributable(losers + pool.amount, FEE).unwrap();
        let group = live_group(dist, pool.amount, &pool).unwrap();

        let pay_a = payout_live(&a, group, &pool).unwrap();
        let pay_b = payout_live(&b, group, &pool).unwrap();
        assert_eq!(pay_b, pay_a * 3);
        assert!(pay_a + pay_b <= group);
    }

    /// Awkward, non-dividing numbers through every branch. The one property
    /// that must hold everywhere: a group never pays out more than it got.
    #[test]
    fn live_payouts_never_exceed_the_group() {
        let holdings = [
            live(111_111, 2, 3_500),
            live(111_113, 2, 1_777),
            live(111_113, 3, 9),
            live(999_999, 1, 2_401),
        ];
        let pool = holdings.iter().fold(LiveTotals::default(), |acc, h| add(acc, *h));

        for pre_lock in [0u64, 1, 333_337, 50_000 * USDC] {
            let losers = 1_000_007u64;
            let dist = distributable(pre_lock + losers + pool.amount, FEE).unwrap();
            let group = live_group(dist, pre_lock + pool.amount, &pool).unwrap();
            assert!(group <= dist);

            let paid: u64 = holdings
                .iter()
                .map(|h| payout_live(h, group, &pool).unwrap())
                .sum();
            assert!(paid <= group, "pre_lock {}: paid {} of {}", pre_lock, paid, group);
            assert!(group - paid < 2 * holdings.len() as u64, "shortfall is dust");

            if pre_lock > 0 {
                let early = payout(pre_lock, dist - group, pre_lock).unwrap();
                assert!(early + paid <= dist);
            }
        }
    }

    #[test]
    fn live_arithmetic_rejects_what_it_should() {
        // A window of nothing.
        assert!(live_multiple_bps(FEE, MAX_2X, 2, 10, 0).is_err());
        // A max that could not even return the deposit less the fee.
        assert!(live_multiple_bps(FEE, 9_899, 2, HOUR, HOUR).is_err());
        assert!(live_terms(100, FEE, 9_899).is_err());
        // An exponent steeper than allowed.
        assert!(live_multiple_bps(FEE, MAX_2X, 4, HOUR, HOUR).is_err());
        // Live money larger than the pool it is supposed to be part of.
        let l = live(100 * USDC, 2, 100);
        assert!(live_group(1, 50 * USDC, &l).is_err());
        // A position claiming more than its pool holds.
        let pool = live(50 * USDC, 2, 100);
        assert!(payout_live(&l, 1, &pool).is_err());
    }

    #[test]
    fn reproduces_the_worked_example_from_the_docs() {
        // ABOVE 70k, BELOW 30k, pot 100k, 1% fee, BELOW wins.
        // Alice holds 1,000 of the 30,000 BELOW pool.
        let pot = 100_000 * USDC;
        let dist = distributable(pot, 100).unwrap();
        assert_eq!(dist, 99_000 * USDC);

        let alice = payout(1_000 * USDC, dist, 30_000 * USDC).unwrap();
        assert_eq!(alice, 3_300 * USDC);
    }

    #[test]
    fn a_zero_fee_distributes_the_whole_pot() {
        let pot = 400 * USDC;
        assert_eq!(distributable(pot, 0).unwrap(), pot);
        assert_eq!(payout(100 * USDC, pot, 100 * USDC).unwrap(), pot);
    }

    #[test]
    fn the_sole_winner_takes_everything_distributable() {
        let pot = 400 * USDC;
        let dist = distributable(pot, 100).unwrap();
        // One depositor holding the entire winning pool.
        assert_eq!(payout(110 * USDC, dist, 110 * USDC).unwrap(), dist);
    }

    #[test]
    fn payouts_never_exceed_what_is_available() {
        // Three winners with awkward shares that do not divide evenly.
        let pot = 1_000_007;
        let dist = distributable(pot, 100).unwrap();
        let winning_pool = 333_337u64;
        let holdings = [111_111u64, 111_113, 111_113];
        assert_eq!(holdings.iter().sum::<u64>(), winning_pool);

        let total: u64 = holdings
            .iter()
            .map(|h| payout(*h, dist, winning_pool).unwrap())
            .sum();

        assert!(
            total <= dist,
            "paid {} against {} distributable",
            total,
            dist
        );
        // And the shortfall is dust, not a meaningful loss.
        assert!(dist - total < holdings.len() as u64);
    }

    #[test]
    fn does_not_overflow_on_an_enormous_pot() {
        let pot = u64::MAX;
        let dist = distributable(pot, 100).unwrap();
        assert!(dist < pot);
        // A single holder of the whole winning pool.
        assert_eq!(payout(pot, dist, pot).unwrap(), dist);
    }

    #[test]
    fn rejects_an_empty_winning_pool() {
        assert!(payout(100, 100, 0).is_err());
    }

    #[test]
    fn rejects_a_holding_larger_than_its_own_pool() {
        // Would imply the pool accounting is already broken.
        assert!(payout(200, 100, 100).is_err());
    }

    #[test]
    fn fee_truncates_in_the_users_favour() {
        // 1% of 99 base units is 0.99, which must not round up to 1.
        assert_eq!(fee_amount(99, 100).unwrap(), 0);
        assert_eq!(distributable(99, 100).unwrap(), 99);
    }
}
