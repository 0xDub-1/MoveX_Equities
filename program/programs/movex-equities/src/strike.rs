//! On-chain strike derivation.
//!
//! The keeper computes a strike off-chain and passes it to `init_market`
//! along with the 20 sessions it came from. This module recomputes the
//! percentile from those samples and rejects any market where the two
//! disagree.
//!
//! That is what turns the threshold from an assertion into a constraint. A
//! keeper cannot publish a series and then quote a strike that the series
//! does not produce, whether by bug or by choice. What remains trusted is
//! only that the samples are the real market data, which is a much smaller
//! claim than "trust our whole pipeline".

use anchor_lang::prelude::*;

use crate::{error::ErrorCode, state::Tier};

/// Interpolation weights for each tier over a 20-element sorted series.
///
/// A percentile at position `idx = p * (n - 1)` sits between `s[lo]` and
/// `s[lo + 1]`, weighted by how far along it lands:
///
/// ```text
///   value = s[lo] * (1 - frac) + s[lo + 1] * frac
///
///   P25 -> idx = 0.25 * 19 =  4.75  -> lo =  4, frac = 0.75
///   P50 -> idx = 0.50 * 19 =  9.50  -> lo =  9, frac = 0.50
///   P75 -> idx = 0.75 * 19 = 14.25  -> lo = 14, frac = 0.25
/// ```
///
/// Every fraction lands on a clean quarter, so the weights are exact
/// hundredths and the whole computation stays in integers. No floating point
/// enters the program, and the keeper can reproduce it bit for bit.
const fn weights(tier: Tier) -> (usize, u32, u32) {
    match tier {
        Tier::Tight => (4, 25, 75),
        Tier::Fair => (9, 50, 50),
        Tier::Wide => (14, 75, 25),
    }
}

/// The strike this series implies for a tier, in basis points.
///
/// Interpolating rather than snapping to the nearer observation matters at
/// n = 20: P50 falls exactly between the 10th and 11th values, and rounding
/// to one of them would tilt the one rung that has to be a genuine coin flip.
pub fn percentile_bps(samples: &[u16; 20], tier: Tier) -> u16 {
    let (lo, w_lo, w_hi) = weights(tier);

    // Max value: 65_535 * 100, which is far inside u32.
    let weighted = samples[lo] as u32 * w_lo + samples[lo + 1] as u32 * w_hi;

    // Round half up, matching the keeper.
    ((weighted + 50) / 100) as u16
}

/// Rejects a series that is not sorted ascending.
///
/// The percentile is only meaningful on a sorted series, and an unsorted one
/// would not error on its own: it would quietly produce a number from the
/// wrong positions.
pub fn assert_sorted(samples: &[u16; 20]) -> Result<()> {
    for i in 1..samples.len() {
        require!(samples[i] >= samples[i - 1], ErrorCode::SamplesNotSorted);
    }
    Ok(())
}

/// The check `init_market` runs before a market can exist.
pub fn verify_strike(samples: &[u16; 20], tier: Tier, strike_bps: u16) -> Result<()> {
    assert_sorted(samples)?;

    let derived = percentile_bps(samples, tier);
    require!(
        derived == strike_bps,
        ErrorCode::StrikeNotDerivedFromSamples
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// NVDA's real close-to-close series for the window ending 2026-09-11,
    /// in basis points. The same series quoted in the public docs, so these
    /// assertions pin the published ladder.
    const NVDA: [u16; 20] = [
        3, 6, 7, 33, 84, 91, 98, 99, 148, 151, 159, 180, 201, 219, 234, 237, 291, 321, 457, 874,
    ];

    #[test]
    fn reproduces_the_published_nvda_ladder() {
        assert_eq!(percentile_bps(&NVDA, Tier::Tight), 89);
        assert_eq!(percentile_bps(&NVDA, Tier::Fair), 155);
        assert_eq!(percentile_bps(&NVDA, Tier::Wide), 235);
    }

    #[test]
    fn ladder_widens_monotonically() {
        let tight = percentile_bps(&NVDA, Tier::Tight);
        let fair = percentile_bps(&NVDA, Tier::Fair);
        let wide = percentile_bps(&NVDA, Tier::Wide);
        assert!(tight <= fair && fair <= wide);
    }

    #[test]
    fn one_violent_session_cannot_drag_the_median() {
        // Ten-fold the largest move. It stays at the right edge of the
        // sorted series and the middle does not move. A mean would have.
        let mut extreme = NVDA;
        extreme[19] = 8_740;
        assert_eq!(percentile_bps(&extreme, Tier::Fair), 155);
        assert_eq!(percentile_bps(&extreme, Tier::Tight), 89);
    }

    #[test]
    fn flat_series_collapses_to_one_value() {
        let flat = [200u16; 20];
        assert_eq!(percentile_bps(&flat, Tier::Tight), 200);
        assert_eq!(percentile_bps(&flat, Tier::Fair), 200);
        assert_eq!(percentile_bps(&flat, Tier::Wide), 200);
    }

    #[test]
    fn accepts_a_strike_its_series_produces() {
        assert!(verify_strike(&NVDA, Tier::Fair, 155).is_ok());
    }

    #[test]
    fn rejects_a_strike_off_by_one_bp() {
        assert!(verify_strike(&NVDA, Tier::Fair, 156).is_err());
        assert!(verify_strike(&NVDA, Tier::Fair, 154).is_err());
    }

    #[test]
    fn rejects_a_strike_from_the_wrong_tier() {
        // 89 is a real strike for this series, just not this tier.
        assert!(verify_strike(&NVDA, Tier::Fair, 89).is_err());
    }

    #[test]
    fn rejects_an_unsorted_series() {
        let mut unsorted = NVDA;
        unsorted.swap(0, 19);
        assert!(assert_sorted(&unsorted).is_err());
        assert!(verify_strike(&unsorted, Tier::Fair, 155).is_err());
    }

    #[test]
    fn no_overflow_at_the_top_of_the_range() {
        let maxed = [u16::MAX; 20];
        assert_eq!(percentile_bps(&maxed, Tier::Wide), u16::MAX);
    }
}
