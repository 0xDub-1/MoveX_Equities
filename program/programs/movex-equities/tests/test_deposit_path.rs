//! Phase 1 exit criteria.
//!
//! Creates a market, has two wallets deposit on opposite sides, has one of
//! them withdraw before lock, and asserts every balance and pool total to the
//! base unit. Then the paths that must fail, fail.
//!
//! Runs on litesvm, in process, with no validator. The whole file executes in
//! well under a second, which is what makes it worth running on every change.

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{
            instruction::Instruction, program_pack::Pack, system_instruction, system_program,
        },
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token,
    litesvm::LiteSVM,
    movex_equities::{
        instructions::InitMarketParams,
        state::{Market, MarketState, Position, Side, Tier},
    },
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const USDC_DECIMALS: u8 = 6;
const USDC: u64 = 1_000_000;

/// NVDA's real close-to-close series for the window ending 2026-09-11, in
/// basis points. The same fixture the keeper and strike.rs both use.
const NVDA_SAMPLES: [u16; 20] = [
    3, 6, 7, 33, 84, 91, 98, 99, 148, 151, 159, 180, 201, 219, 234, 237, 291, 321, 457, 874,
];
const NVDA_FAIR_STRIKE: u16 = 155;

const TICKER: &[u8; 8] = b"NVDA    ";
const SESSION: &[u8; 10] = b"2026-09-16";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

struct Ctx {
    svm: LiteSVM,
    program_id: Pubkey,
    admin: Keypair,
    mint: Pubkey,
    market: Pubkey,
    vault: Pubkey,
    pyth_feed: Pubkey,
}

fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    ixs: &[Instruction],
    signers: &[&Keypair],
) -> std::result::Result<(), String> {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers)
        .map_err(|e| e.to_string())?;
    svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e))
}

fn token_balance(svm: &LiteSVM, account: &Pubkey) -> u64 {
    let raw = svm.get_account(account).expect("token account missing");
    spl_token::state::Account::unpack(&raw.data).expect("not a token account").amount
}

fn market_state(svm: &LiteSVM, market: &Pubkey) -> Market {
    let raw = svm.get_account(market).expect("market missing");
    let mut data: &[u8] = &raw.data;
    Market::try_deserialize(&mut data).expect("not a Market")
}

fn position_state(svm: &LiteSVM, position: &Pubkey) -> Position {
    let raw = svm.get_account(position).expect("position missing");
    let mut data: &[u8] = &raw.data;
    Position::try_deserialize(&mut data).expect("not a Position")
}

fn create_mint(svm: &mut LiteSVM, payer: &Keypair) -> Pubkey {
    let mint = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(spl_token::state::Mint::LEN);
    let ixs = [
        system_instruction::create_account(
            &payer.pubkey(),
            &mint.pubkey(),
            rent,
            spl_token::state::Mint::LEN as u64,
            &spl_token::ID,
        ),
        spl_token::instruction::initialize_mint2(
            &spl_token::ID,
            &mint.pubkey(),
            &payer.pubkey(),
            None,
            USDC_DECIMALS,
        )
        .unwrap(),
    ];
    send(svm, payer, &ixs, &[payer, &mint]).expect("create mint");
    mint.pubkey()
}

/// A funded wallet with a token account holding `amount`.
fn funded_wallet(svm: &mut LiteSVM, admin: &Keypair, mint: &Pubkey, amount: u64) -> (Keypair, Pubkey) {
    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10 * 1_000_000_000).unwrap();

    let ata = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(spl_token::state::Account::LEN);
    let ixs = [
        system_instruction::create_account(
            &user.pubkey(),
            &ata.pubkey(),
            rent,
            spl_token::state::Account::LEN as u64,
            &spl_token::ID,
        ),
        spl_token::instruction::initialize_account3(
            &spl_token::ID,
            &ata.pubkey(),
            mint,
            &user.pubkey(),
        )
        .unwrap(),
    ];
    send(svm, &user, &ixs, &[&user, &ata]).expect("create token account");

    let mint_to = spl_token::instruction::mint_to(
        &spl_token::ID,
        mint,
        &ata.pubkey(),
        &admin.pubkey(),
        &[],
        amount,
    )
    .unwrap();
    send(svm, admin, &[mint_to], &[admin]).expect("mint to user");

    (user, ata.pubkey())
}

fn setup() -> Ctx {
    let program_id = movex_equities::id();
    let mut svm = LiteSVM::new();

    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/movex_equities.so"
    ));
    svm.add_program(program_id, bytes).unwrap();

    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 100 * 1_000_000_000).unwrap();

    let mint = create_mint(&mut svm, &admin);

    let (market, _) = Pubkey::find_program_address(
        &[b"market", TICKER, SESSION, Tier::Fair.as_seed()],
        &program_id,
    );
    let (vault, _) = Pubkey::find_program_address(&[b"vault", market.as_ref()], &program_id);

    Ctx {
        svm,
        program_id,
        admin,
        mint,
        market,
        vault,
        pyth_feed: Pubkey::new_unique(),
    }
}

fn default_params(ctx: &Ctx) -> InitMarketParams {
    let now = ctx.svm.get_sysvar::<anchor_lang::prelude::Clock>().unix_timestamp;
    InitMarketParams {
        underlying: *TICKER,
        session_date: *SESSION,
        tier: Tier::Fair,
        strike_bps: NVDA_FAIR_STRIKE,
        samples_bps: NVDA_SAMPLES,
        fee_bps: 100,
        lock_ts: now + 3_600,
        settle_ts: now + 90_000,
    }
}

fn init_market(ctx: &mut Ctx, params: InitMarketParams) -> std::result::Result<(), String> {
    let ix = Instruction::new_with_bytes(
        ctx.program_id,
        &movex_equities::instruction::InitMarket { params }.data(),
        movex_equities::accounts::InitMarket {
            authority: ctx.admin.pubkey(),
            market: ctx.market,
            quote_mint: ctx.mint,
            vault: ctx.vault,
            pyth_feed: ctx.pyth_feed,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let admin = ctx.admin.insecure_clone();
    send(&mut ctx.svm, &admin, &[ix], &[&admin])
}

fn position_pda(ctx: &Ctx, user: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"position", ctx.market.as_ref(), user.as_ref()],
        &ctx.program_id,
    )
    .0
}

fn deposit(
    ctx: &mut Ctx,
    user: &Keypair,
    ata: &Pubkey,
    side: Side,
    amount: u64,
) -> std::result::Result<(), String> {
    let ix = Instruction::new_with_bytes(
        ctx.program_id,
        &movex_equities::instruction::Deposit { side, amount }.data(),
        movex_equities::accounts::Deposit {
            user: user.pubkey(),
            market: ctx.market,
            position: position_pda(ctx, &user.pubkey()),
            vault: ctx.vault,
            user_token_account: *ata,
            quote_mint: ctx.mint,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut ctx.svm, user, &[ix], &[user])
}

fn withdraw(
    ctx: &mut Ctx,
    user: &Keypair,
    ata: &Pubkey,
    amount: u64,
) -> std::result::Result<(), String> {
    let ix = Instruction::new_with_bytes(
        ctx.program_id,
        &movex_equities::instruction::Withdraw { amount }.data(),
        movex_equities::accounts::Withdraw {
            user: user.pubkey(),
            market: ctx.market,
            position: position_pda(ctx, &user.pubkey()),
            vault: ctx.vault,
            user_token_account: *ata,
            quote_mint: ctx.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
    );
    send(&mut ctx.svm, user, &[ix], &[user])
}

// ---------------------------------------------------------------------------
// The exit criteria
// ---------------------------------------------------------------------------

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

    let (alice, alice_ata) = funded_wallet(&mut ctx.svm, &ctx.admin.insecure_clone(), &ctx.mint, 1_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx.svm, &ctx.admin.insecure_clone(), &ctx.mint, 1_000 * USDC);

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
    let (alice, ata) = funded_wallet(&mut ctx.svm, &ctx.admin.insecure_clone(), &ctx.mint, 1_000 * USDC);

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
    let (alice, ata) = funded_wallet(&mut ctx.svm, &ctx.admin.insecure_clone(), &ctx.mint, 1_000 * USDC);

    assert!(deposit(&mut ctx, &alice, &ata, Side::Above, 1).is_err());
    assert!(deposit(&mut ctx, &alice, &ata, Side::Above, USDC - 1).is_err());
    assert!(deposit(&mut ctx, &alice, &ata, Side::Above, USDC).is_ok());
}

#[test]
fn rejects_holding_both_sides_at_once() {
    let mut ctx = setup();
    let params = default_params(&ctx);
    init_market(&mut ctx, params).unwrap();
    let (alice, ata) = funded_wallet(&mut ctx.svm, &ctx.admin.insecure_clone(), &ctx.mint, 1_000 * USDC);

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
    let (alice, alice_ata) = funded_wallet(&mut ctx.svm, &ctx.admin.insecure_clone(), &ctx.mint, 1_000 * USDC);
    let (bob, bob_ata) = funded_wallet(&mut ctx.svm, &ctx.admin.insecure_clone(), &ctx.mint, 1_000 * USDC);

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
    let (alice, ata) = funded_wallet(&mut ctx.svm, &ctx.admin.insecure_clone(), &ctx.mint, 1_000 * USDC);

    deposit(&mut ctx, &alice, &ata, Side::Above, 100 * USDC).expect("before lock");

    // Jump the clock past the deposit window.
    let mut clock = ctx.svm.get_sysvar::<anchor_lang::prelude::Clock>();
    clock.unix_timestamp = lock_ts + 1;
    ctx.svm.set_sysvar(&clock);

    assert!(deposit(&mut ctx, &alice, &ata, Side::Above, 100 * USDC).is_err());
    assert!(
        withdraw(&mut ctx, &alice, &ata, 50 * USDC).is_err(),
        "the escape hatch closes with the deposit window"
    );
}
