//! Shared test harness.
//!
//! litesvm runs the SVM in process, so a market can be driven from creation
//! to claim in a fraction of a second with no validator and no market hours.
//! That is what makes the mock oracle worth building before touching Pyth.

#![allow(dead_code)]

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{
            instruction::Instruction, program_pack::Pack, system_instruction, system_program,
        },
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token,
    litesvm::LiteSVM,
    movex_equities::{
        instructions::InitMarketParams,
        state::{Market, Position, Side, Tier},
    },
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

pub const USDC_DECIMALS: u8 = 6;
pub const USDC: u64 = 1_000_000;

/// NVDA's real close-to-close series for the window ending 2026-09-11, in
/// basis points. The same fixture the keeper and strike.rs both carry.
pub const NVDA_SAMPLES: [u16; 20] = [
    3, 6, 7, 33, 84, 91, 98, 99, 148, 151, 159, 180, 201, 219, 234, 237, 291, 321, 457, 874,
];
pub const NVDA_FAIR_STRIKE: u16 = 155;

pub const TICKER: &[u8; 8] = b"NVDA    ";
pub const SESSION: &[u8; 10] = b"2026-09-16";

/// A reference price with room for a large move in either direction without
/// getting near any integer boundary. 218.29 in cents, matching the docs.
pub const REFERENCE_PRICE: u64 = 21_829;

pub struct Ctx {
    pub svm: LiteSVM,
    pub program_id: Pubkey,
    pub admin: Keypair,
    pub mint: Pubkey,
    pub market: Pubkey,
    pub vault: Pubkey,
    /// The mock price account this market settles against.
    pub price_feed: Pubkey,
}

pub fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    ixs: &[Instruction],
    signers: &[&Keypair],
) -> Result<(), String> {
    // Two identical instructions from the same signer on the same blockhash
    // produce the same signature, and the second is rejected as
    // AlreadyProcessed. Tests legitimately do that (setting the same mock
    // price twice, cranking the same market twice), so every send gets a
    // fresh blockhash rather than every call site working around it.
    svm.expire_blockhash();

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers)
        .map_err(|e| e.to_string())?;
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{:?}", e))
}

pub fn token_balance(svm: &LiteSVM, account: &Pubkey) -> u64 {
    let raw = svm.get_account(account).expect("token account missing");
    spl_token::state::Account::unpack(&raw.data)
        .expect("not a token account")
        .amount
}

pub fn market_state(svm: &LiteSVM, market: &Pubkey) -> Market {
    let raw = svm.get_account(market).expect("market missing");
    let mut data: &[u8] = &raw.data;
    Market::try_deserialize(&mut data).expect("not a Market")
}

pub fn position_state(svm: &LiteSVM, position: &Pubkey) -> Position {
    let raw = svm.get_account(position).expect("position missing");
    let mut data: &[u8] = &raw.data;
    Position::try_deserialize(&mut data).expect("not a Position")
}

pub fn now(svm: &LiteSVM) -> i64 {
    svm.get_sysvar::<Clock>().unix_timestamp
}

/// Moves the cluster clock forward. The whole reason a full lifecycle test
/// takes milliseconds instead of two days.
pub fn warp_to(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar(&clock);
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
pub fn funded_wallet(ctx: &mut Ctx, amount: u64) -> (Keypair, Pubkey) {
    let admin = ctx.admin.insecure_clone();
    let user = Keypair::new();
    ctx.svm.airdrop(&user.pubkey(), 10 * 1_000_000_000).unwrap();

    let ata = Keypair::new();
    let rent = ctx
        .svm
        .minimum_balance_for_rent_exemption(spl_token::state::Account::LEN);
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
            &ctx.mint,
            &user.pubkey(),
        )
        .unwrap(),
    ];
    send(&mut ctx.svm, &user, &ixs, &[&user, &ata]).expect("create token account");

    let mint_to = spl_token::instruction::mint_to(
        &spl_token::ID,
        &ctx.mint,
        &ata.pubkey(),
        &admin.pubkey(),
        &[],
        amount,
    )
    .unwrap();
    send(&mut ctx.svm, &admin, &[mint_to], &[&admin]).expect("mint to user");

    (user, ata.pubkey())
}

pub fn setup() -> Ctx {
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
    let (price_feed, _) = Pubkey::find_program_address(&[b"mock_price", TICKER], &program_id);

    Ctx {
        svm,
        program_id,
        admin,
        mint,
        market,
        vault,
        price_feed,
    }
}

pub fn default_params(ctx: &Ctx) -> InitMarketParams {
    let t = now(&ctx.svm);
    InitMarketParams {
        underlying: *TICKER,
        session_date: *SESSION,
        tier: Tier::Fair,
        strike_bps: NVDA_FAIR_STRIKE,
        samples_bps: NVDA_SAMPLES,
        fee_bps: 100,
        lock_ts: t + 3_600,
        settle_ts: t + 90_000,
    }
}

pub fn position_pda(ctx: &Ctx, user: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"position", ctx.market.as_ref(), user.as_ref()],
        &ctx.program_id,
    )
    .0
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

/// `publish_time: None` means "as of now".
///
/// Gated with the instruction it calls, so a build without the mock oracle
/// still compiles its tests rather than failing on a missing account type.
#[cfg(feature = "dev-oracle")]
pub fn set_mock_price(
    ctx: &mut Ctx,
    price: u64,
    publish_time: Option<i64>,
) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        ctx.program_id,
        &movex_equities::instruction::SetMockPrice {
            underlying: *TICKER,
            price,
            publish_time,
        }
        .data(),
        movex_equities::accounts::SetMockPrice {
            authority: ctx.admin.pubkey(),
            mock_price: ctx.price_feed,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let admin = ctx.admin.insecure_clone();
    send(&mut ctx.svm, &admin, &[ix], &[&admin])
}

pub fn init_market(ctx: &mut Ctx, params: InitMarketParams) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        ctx.program_id,
        &movex_equities::instruction::InitMarket { params }.data(),
        movex_equities::accounts::InitMarket {
            authority: ctx.admin.pubkey(),
            market: ctx.market,
            quote_mint: ctx.mint,
            vault: ctx.vault,
            pyth_feed: ctx.price_feed,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let admin = ctx.admin.insecure_clone();
    send(&mut ctx.svm, &admin, &[ix], &[&admin])
}

pub fn deposit(
    ctx: &mut Ctx,
    user: &Keypair,
    ata: &Pubkey,
    side: Side,
    amount: u64,
) -> Result<(), String> {
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

pub fn withdraw(ctx: &mut Ctx, user: &Keypair, ata: &Pubkey, amount: u64) -> Result<(), String> {
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

/// Permissionless, so the cranker is deliberately a stranger in tests.
pub fn lock(ctx: &mut Ctx) -> Result<(), String> {
    let cranker = Keypair::new();
    ctx.svm.airdrop(&cranker.pubkey(), 1_000_000_000).unwrap();

    let ix = Instruction::new_with_bytes(
        ctx.program_id,
        &movex_equities::instruction::Lock {}.data(),
        movex_equities::accounts::Lock {
            cranker: cranker.pubkey(),
            market: ctx.market,
            price_feed: ctx.price_feed,
        }
        .to_account_metas(None),
    );
    send(&mut ctx.svm, &cranker, &[ix], &[&cranker])
}

pub fn settle(ctx: &mut Ctx) -> Result<(), String> {
    let cranker = Keypair::new();
    ctx.svm.airdrop(&cranker.pubkey(), 1_000_000_000).unwrap();

    let ix = Instruction::new_with_bytes(
        ctx.program_id,
        &movex_equities::instruction::Settle {}.data(),
        movex_equities::accounts::Settle {
            cranker: cranker.pubkey(),
            market: ctx.market,
            price_feed: ctx.price_feed,
        }
        .to_account_metas(None),
    );
    send(&mut ctx.svm, &cranker, &[ix], &[&cranker])
}

pub fn void_market(ctx: &mut Ctx) -> Result<(), String> {
    let cranker = Keypair::new();
    ctx.svm.airdrop(&cranker.pubkey(), 1_000_000_000).unwrap();

    let ix = Instruction::new_with_bytes(
        ctx.program_id,
        &movex_equities::instruction::VoidMarket {}.data(),
        movex_equities::accounts::VoidMarket {
            cranker: cranker.pubkey(),
            market: ctx.market,
        }
        .to_account_metas(None),
    );
    send(&mut ctx.svm, &cranker, &[ix], &[&cranker])
}

pub fn claim(ctx: &mut Ctx, user: &Keypair, ata: &Pubkey) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        ctx.program_id,
        &movex_equities::instruction::Claim {}.data(),
        movex_equities::accounts::Claim {
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
