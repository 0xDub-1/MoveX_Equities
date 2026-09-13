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

    // -- lifecycle ----------------------------------------------------------
    #[msg("Market is not locked")]
    MarketNotLocked,
    #[msg("Market has not resolved yet")]
    MarketNotResolved,
    #[msg("Too early to lock this market")]
    TooEarlyToLock,
    #[msg("Too early to settle this market")]
    TooEarlyToSettle,
    #[msg("Too early to void this market")]
    TooEarlyToVoid,
    #[msg("Market has already resolved")]
    MarketAlreadyResolved,

    // -- oracle -------------------------------------------------------------
    #[msg("Oracle account does not match the one this market was created with")]
    OracleFeedMismatch,
    #[msg("Oracle account could not be read")]
    OracleAccountInvalid,
    #[msg("Oracle price is stale")]
    OraclePriceStale,
    #[msg("Oracle price is not usable")]
    OraclePriceInvalid,
    #[msg("This build has no oracle configured")]
    OracleNotConfigured,

    // -- claim --------------------------------------------------------------
    #[msg("This position has already been claimed")]
    AlreadyClaimed,
    #[msg("This position is not on the winning side")]
    NotOnWinningSide,
    #[msg("There is nothing to claim")]
    NothingToClaim,
    #[msg("The protocol fee has already been collected")]
    FeeAlreadyCollected,
}
