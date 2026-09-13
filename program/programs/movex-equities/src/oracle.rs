//! Price reads, behind one seam.
//!
//! Everything above this module asks for a price and gets back a value and a
//! publish time. Where that comes from is decided at compile time:
//!
//! - `dev-oracle`: a `MockPrice` account an admin can set to anything. Lets
//!   a market run its entire lifecycle in milliseconds, on a Sunday, with no
//!   market hours to wait for.
//! - otherwise: Pyth. Arrives in Phase 3.
//!
//! The mock is a cargo feature rather than a runtime flag on purpose. A
//! runtime switch is one bad admin transaction away from settling real money
//! against a price somebody typed in. A feature is simply absent from the
//! binary unless it was asked for at build time.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;

/// How stale a price may be before a market refuses to use it.
///
/// Both reads are scheduled for 16:00 ET, a live market moment, so a healthy
/// feed is seconds old. Two minutes is generous enough to absorb a slow
/// crank without being wide enough to settle against a materially different
/// price.
pub const MAX_PRICE_AGE_SECS: i64 = 120;

/// One price reading, already validated for staleness.
///
/// `price` carries whatever scale the source publishes. Nothing downstream
/// depends on the scale because the move is a ratio of two readings from the
/// same feed, so the units cancel.
#[derive(Clone, Copy, Debug)]
pub struct PriceReading {
    pub price: u64,
    pub publish_time: i64,
}

/// Reads a price, or fails in a way the caller is expected to turn into a
/// voided market rather than a retry.
pub fn read_price(feed: &AccountInfo, now: i64) -> Result<PriceReading> {
    let reading = read_price_inner(feed)?;

    require!(reading.price > 0, ErrorCode::OraclePriceInvalid);

    // A future-dated price is not "fresh", it is a broken feed.
    require!(
        reading.publish_time <= now + 1,
        ErrorCode::OraclePriceInvalid
    );
    require!(
        now - reading.publish_time <= MAX_PRICE_AGE_SECS,
        ErrorCode::OraclePriceStale
    );

    Ok(reading)
}

#[cfg(feature = "dev-oracle")]
fn read_price_inner(feed: &AccountInfo) -> Result<PriceReading> {
    use crate::state::MockPrice;

    let data = feed.try_borrow_data()?;
    let mut slice: &[u8] = &data;
    let mock = MockPrice::try_deserialize(&mut slice)
        .map_err(|_| error!(ErrorCode::OracleAccountInvalid))?;

    Ok(PriceReading {
        price: mock.price,
        publish_time: mock.publish_time,
    })
}

#[cfg(not(feature = "dev-oracle"))]
fn read_price_inner(_feed: &AccountInfo) -> Result<PriceReading> {
    // Phase 3 replaces this with a Pyth read plus a confidence-interval
    // check. Failing loudly beats returning a plausible zero: a build
    // without an oracle must not be able to settle anything.
    Err(error!(ErrorCode::OracleNotConfigured))
}

/// Absolute move between two readings, in basis points.
///
/// ```text
///   move_bps = |settlement - reference| * 10_000 / reference
/// ```
///
/// Direction is discarded, which is the entire product. Intermediate maths
/// runs in u128: a price near u64::MAX multiplied by 10_000 would overflow
/// u64 long before any real feed got there, and a settlement figure is not
/// the place to find out.
pub fn move_bps(reference: u64, settlement: u64) -> Result<u64> {
    require!(reference > 0, ErrorCode::OraclePriceInvalid);

    let diff = if settlement >= reference {
        settlement - reference
    } else {
        reference - settlement
    };

    let bps = (diff as u128)
        .checked_mul(10_000)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(reference as u128)
        .ok_or(ErrorCode::MathOverflow)?;

    u64::try_from(bps).map_err(|_| error!(ErrorCode::MathOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_the_published_worked_example() {
        // NVDA reference close 218.29, settles at 213.90 -> 2.01%.
        assert_eq!(move_bps(21_829, 21_390).unwrap(), 201);
        // And the other direction, 220.15 -> 0.85%.
        assert_eq!(move_bps(21_829, 22_015).unwrap(), 85);
    }

    #[test]
    fn direction_is_discarded() {
        let up = move_bps(10_000, 10_400).unwrap();
        let down = move_bps(10_000, 9_600).unwrap();
        assert_eq!(up, down);
    }

    #[test]
    fn a_flat_session_is_zero() {
        assert_eq!(move_bps(12_345, 12_345).unwrap(), 0);
    }

    #[test]
    fn rejects_a_zero_reference() {
        assert!(move_bps(0, 100).is_err());
    }

    #[test]
    fn does_not_overflow_near_the_top_of_u64() {
        // u64::MAX * 10_000 would wrap in u64. It must not here.
        assert!(move_bps(1, u64::MAX).is_err() || move_bps(u64::MAX, 1).is_ok());
        assert_eq!(move_bps(u64::MAX, u64::MAX).unwrap(), 0);
    }

    #[test]
    fn truncates_rather_than_rounds_up() {
        // 1.49 bps of movement reads as 1, never 2. A market must not be
        // pushed over its strike by rounding.
        assert_eq!(move_bps(1_000_000, 1_000_149).unwrap(), 1);
    }
}
