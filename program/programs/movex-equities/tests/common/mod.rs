//! Shared test harness.
//!
//! litesvm runs the SVM in process, so a market can be driven from creation
//! to claim in a fraction of a second with no validator and no market hours.
//! That is what makes the keeper oracle worth having behind a seam: the same
//! account shape is written by a test here and by the keeper on devnet.

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
    /// The keeper price feed this market settles against.
    pub price_feed: Pubkey,
    /// Wallet entitled to the protocol fee, and its token account.
    pub treasury: Keypair,
    pub treasury_ata: Pubkey,
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

/// An empty token account for `owner`, paid for by `payer`.
fn create_token_account(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint: &Pubkey,
    owner: &Pubkey,
) -> Pubkey {
    let ata = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(spl_token::state::Account::LEN);
    let ixs = [
        system_instruction::create_account(
            &payer.pubkey(),
            &ata.pubkey(),
            rent,
            spl_token::state::Account::LEN as u64,
            &spl_token::ID,
        ),
        spl_token::instruction::initialize_account3(&spl_token::ID, &ata.pubkey(), mint, owner)
            .unwrap(),
    ];
    send(svm, payer, &ixs, &[payer, &ata]).expect("create token account");
    ata.pubkey()
}

/// A funded wallet with a token account holding `amount`.
pub fn funded_wallet(ctx: &mut Ctx, amount: u64) -> (Keypair, Pubkey) {
    let admin = ctx.admin.insecure_clone();
    let user = Keypair::new();
    ctx.svm.airdrop(&user.pubkey(), 10 * 1_000_000_000).unwrap();

    let mint = ctx.mint;
    let ata = create_token_account(&mut ctx.svm, &user, &mint, &user.pubkey());

    let mint_to = spl_token::instruction::mint_to(
        &spl_token::ID,
        &mint,
        &ata,
        &admin.pubkey(),
        &[],
        amount,
    )
    .unwrap();
    send(&mut ctx.svm, &admin, &[mint_to], &[&admin]).expect("mint to user");

    (user, ata)
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
    let (price_feed, _) = Pubkey::find_program_address(&[b"price_feed", TICKER], &program_id);

    let treasury = Keypair::new();
    svm.airdrop(&treasury.pubkey(), 1_000_000_000).unwrap();
    let treasury_ata = create_token_account(&mut svm, &admin, &mint, &treasury.pubkey());

    let mut ctx = Ctx {
        svm,
        program_id,
        admin,
        mint,
        market,
        vault,
        price_feed,
        treasury,
        treasury_ata,
    };

    // The feed account has to exist before anything can publish into it.
    #[cfg(feature = "keeper-oracle")]
    init_price_feed(&mut ctx).expect("init_price_feed");

    ctx
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
        treasury: ctx.treasury.pubkey(),
        lock_ts: t + 3_600,
        settle_ts: t + 90_000,
    }
}

pub fn collect_fee(ctx: &mut Ctx) -> Result<(), String> {
    let cranker = Keypair::new();
    ctx.svm.airdrop(&cranker.pubkey(), 1_000_000_000).unwrap();

    let ix = Instruction::new_with_bytes(
        ctx.program_id,
        &movex_equities::instruction::CollectFee {}.data(),
        movex_equities::accounts::CollectFee {
            cranker: cranker.pubkey(),
            market: ctx.market,
            vault: ctx.vault,
            treasury_token_account: ctx.treasury_ata,
            quote_mint: ctx.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
    );
    send(&mut ctx.svm, &cranker, &[ix], &[&cranker])
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

/// Opens the keeper price feed. Called once from `setup`.
#[cfg(feature = "keeper-oracle")]
pub fn init_price_feed(ctx: &mut Ctx) -> Result<(), String> {
    let admin = ctx.admin.insecure_clone();
    let ix = Instruction::new_with_bytes(
        ctx.program_id,
        &movex_equities::instruction::InitPriceFeed {
            underlying: *TICKER,
            publisher: admin.pubkey(),
        }
        .data(),
        movex_equities::accounts::InitPriceFeed {
            authority: admin.pubkey(),
            price_feed: ctx.price_feed,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut ctx.svm, &admin, &[ix], &[&admin])
}

/// Publishes a price. `publish_time: None` means "as of now".
///
/// The program requires each price to be strictly newer than the last, so a
/// test that publishes twice at the same clock would be rejected. Nudging the
/// clock forward here keeps that guarantee real in the program rather than
/// relaxing it for the convenience of tests.
#[cfg(feature = "keeper-oracle")]
pub fn set_mock_price(
    ctx: &mut Ctx,
    price: u64,
    publish_time: Option<i64>,
) -> Result<(), String> {
    let admin = ctx.admin.insecure_clone();

    let ts = match publish_time {
        Some(t) => t,
        None => {
            let current = ctx
                .svm
                .get_account(&ctx.price_feed)
                .map(|raw| {
                    let mut data: &[u8] = &raw.data;
                    movex_equities::state::PriceFeed::try_deserialize(&mut data)
                        .map(|f| f.publish_time)
                        .unwrap_or(0)
                })
                .unwrap_or(0);
            if now(&ctx.svm) <= current {
                warp_to(&mut ctx.svm, current + 1);
            }
            now(&ctx.svm)
        }
    };

    let ix = Instruction::new_with_bytes(
        ctx.program_id,
        &movex_equities::instruction::UpdatePrice {
            price,
            conf: 0,
            publish_time: ts,
            source_count: 1,
        }
        .data(),
        movex_equities::accounts::UpdatePrice {
            publisher: admin.pubkey(),
            price_feed: ctx.price_feed,
        }
        .to_account_metas(None),
    );
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
