use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Market is not open for deposits")]
    MarketNotOpen,
    #[msg("The deposit window has closed")]
    DepositWindowClosed,
    #[msg("Deposit is below the minimum")]
    DepositTooSmall,
    #[msg("Withdrawal exceeds the position balance")]
    InsufficientPosition,
    #[msg("A position already exists on the other side of this market")]
    SideMismatch,
    #[msg("Fee exceeds the maximum allowed")]
    FeeTooHigh,
    #[msg("Strike must be greater than zero")]
    StrikeTooSmall,
    #[msg("The sample series must be sorted ascending")]
    SamplesNotSorted,
    #[msg("Strike does not match the percentile of its own sample series")]
    StrikeNotDerivedFromSamples,
    #[msg("Lock time must be in the future")]
    LockTimeInPast,
    #[msg("Settle time must be after lock time")]
    SettleBeforeLock,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
