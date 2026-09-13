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

/// The confidence band may be at most 1/100th of the price, so 1%.
///
/// Expressed as a divisor rather than basis points because the comparison is
/// `conf <= price / RATIO`, which needs no multiplication and therefore no
/// overflow check on the price side.
pub const MAX_CONFIDENCE_RATIO: u64 = 100;

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

#[cfg(feature = "keeper-oracle")]
fn read_price_inner(feed: &AccountInfo) -> Result<PriceReading> {
    use crate::state::PriceFeed;

    let data = feed.try_borrow_data()?;
    let mut slice: &[u8] = &data;
    let published = PriceFeed::try_deserialize(&mut slice)
        .map_err(|_| error!(ErrorCode::OracleAccountInvalid))?;

    // The same confidence bound the Pyth path applies. `update_price`
    // enforces it on write too; repeating it on read means a feed whose
    // bound was later loosened cannot settle a market that was created
    // under the stricter one.
    let max_conf = published
        .price
        .checked_div(MAX_CONFIDENCE_RATIO)
        .ok_or(ErrorCode::MathOverflow)?;
    require!(
        published.conf <= max_conf,
        ErrorCode::OracleConfidenceTooWide
    );

    Ok(PriceReading {
        price: published.price,
        publish_time: published.publish_time,
    })
}

/// Exponent every reading is normalised to.
///
/// Pyth publishes a price plus its own exponent, and that exponent is not
/// guaranteed to be identical between two reads of the same feed. Comparing
/// a reference taken at one exponent against a settlement taken at another
/// would produce a move that is wrong by a factor of ten, silently. So both
/// are converted to a fixed scale on the way in and the rest of the program
/// never sees an exponent at all.
#[cfg(not(feature = "keeper-oracle"))]
pub const TARGET_EXPONENT: i32 = -8;

#[cfg(not(feature = "keeper-oracle"))]
fn read_price_inner(feed: &AccountInfo) -> Result<PriceReading> {
    use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

    let data = feed.try_borrow_data()?;
    let mut slice: &[u8] = &data;
    let update = PriceUpdateV2::try_deserialize(&mut slice)
        .map_err(|_| error!(ErrorCode::OracleAccountInvalid))?;

    let message = update.price_message;

    // A negative price is not a cheap stock, it is a broken feed.
    require!(message.price > 0, ErrorCode::OraclePriceInvalid);

    // Confidence is Pyth's own statement of how much its publishers
    // disagree. A wide band at the close means the price we would settle
    // against is not one the market agrees on, so the market voids rather
    // than picking a number out of the spread.
    let price_abs = message.price as u64;
    let max_conf = price_abs
        .checked_div(MAX_CONFIDENCE_RATIO)
        .ok_or(ErrorCode::MathOverflow)?;
    require!(message.conf <= max_conf, ErrorCode::OracleConfidenceTooWide);

    Ok(PriceReading {
        price: normalize(message.price, message.exponent)?,
        publish_time: message.publish_time,
    })
}

/// Rescales a Pyth price to `TARGET_EXPONENT`.
#[cfg(not(feature = "keeper-oracle"))]
fn normalize(price: i64, exponent: i32) -> Result<u64> {
    let shift = exponent
        .checked_sub(TARGET_EXPONENT)
        .ok_or(ErrorCode::MathOverflow)?;

    let value = price as i128;
    let scaled = if shift >= 0 {
        let factor = 10i128
            .checked_pow(u32::try_from(shift).map_err(|_| error!(ErrorCode::MathOverflow))?)
            .ok_or(ErrorCode::MathOverflow)?;
        value.checked_mul(factor).ok_or(ErrorCode::MathOverflow)?
    } else {
        let factor = 10i128
            .checked_pow(u32::try_from(-shift).map_err(|_| error!(ErrorCode::MathOverflow))?)
            .ok_or(ErrorCode::MathOverflow)?;
        value / factor
    };

    u64::try_from(scaled).map_err(|_| error!(ErrorCode::MathOverflow))
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
