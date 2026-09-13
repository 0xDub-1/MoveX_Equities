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

#[cfg(test)]
mod tests {
    use super::*;

    const USDC: u64 = 1_000_000;

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
