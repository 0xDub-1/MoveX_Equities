//! Self-serve test-token faucet.
//!
//!     anchor build --arch v0 -- --features devnet-faucet
//!     cargo test --features devnet-faucet
#![cfg(feature = "devnet-faucet")]

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
    movex_equities::state::FaucetClaim,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const USDX: u64 = 1_000_000;
const PER_CLAIM: u64 = 10_000 * USDX;
const COOLDOWN: i64 = 24 * 60 * 60;

struct Ctx {
    svm: LiteSVM,
    program_id: Pubkey,
    admin: Keypair,
    mint: Pubkey,
    faucet: Pubkey,
}

fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    ixs: &[Instruction],
    signers: &[&Keypair],
) -> Result<(), String> {
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers)
        .map_err(|e| e.to_string())?;
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{:?}", e))
}

fn token_balance(svm: &LiteSVM, account: &Pubkey) -> u64 {
    let raw = svm.get_account(account).expect("token account missing");
    spl_token::state::Account::unpack(&raw.data)
        .expect("not a token account")
        .amount
}

fn warp_to(svm: &mut LiteSVM, ts: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = ts;
    svm.set_sysvar(&clock);
}

fn now(svm: &LiteSVM) -> i64 {
    svm.get_sysvar::<Clock>().unix_timestamp
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

    // The faucet PDA is derived from the mint, and the mint's authority must
    // be that PDA. Not circular in practice: the mint's address is known as
    // soon as its keypair exists, so the PDA can be derived before the mint
    // account is initialised.
    let mint_kp = Keypair::new();
    let mint = mint_kp.pubkey();
    let (faucet, _) = Pubkey::find_program_address(&[b"faucet", mint.as_ref()], &program_id);

    let rent = svm.minimum_balance_for_rent_exemption(spl_token::state::Mint::LEN);
    let ixs = [
        system_instruction::create_account(
            &admin.pubkey(),
            &mint,
            rent,
            spl_token::state::Mint::LEN as u64,
            &spl_token::ID,
        ),
        spl_token::instruction::initialize_mint2(&spl_token::ID, &mint, &faucet, None, 6).unwrap(),
    ];
    send(&mut svm, &admin, &ixs, &[&admin, &mint_kp]).expect("create USDX mint");

    Ctx {
        svm,
        program_id,
        admin,
        mint,
        faucet,
    }
}

fn init_faucet(ctx: &mut Ctx, amount: u64, cooldown: i64) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        ctx.program_id,
        &movex_equities::instruction::InitFaucet {
            amount_per_claim: amount,
            cooldown_secs: cooldown,
        }
        .data(),
        movex_equities::accounts::InitFaucet {
            authority: ctx.admin.pubkey(),
            faucet: ctx.faucet,
            mint: ctx.mint,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let admin = ctx.admin.insecure_clone();
    send(&mut ctx.svm, &admin, &[ix], &[&admin])
}

fn wallet(ctx: &mut Ctx) -> (Keypair, Pubkey) {
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
    (user, ata.pubkey())
}

fn claim_pda(ctx: &Ctx, user: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"faucet_claim", ctx.mint.as_ref(), user.as_ref()],
        &ctx.program_id,
    )
    .0
}

fn faucet_mint(ctx: &mut Ctx, user: &Keypair, ata: &Pubkey) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        ctx.program_id,
        &movex_equities::instruction::FaucetMint {}.data(),
        movex_equities::accounts::FaucetMint {
            user: user.pubkey(),
            faucet: ctx.faucet,
            claim: claim_pda(ctx, &user.pubkey()),
            mint: ctx.mint,
            user_token_account: *ata,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut ctx.svm, user, &[ix], &[user])
}

fn claim_state(ctx: &Ctx, user: &Pubkey) -> FaucetClaim {
    let raw = ctx.svm.get_account(&claim_pda(ctx, user)).expect("no claim");
    let mut data: &[u8] = &raw.data;
    FaucetClaim::try_deserialize(&mut data).expect("not a FaucetClaim")
}

// ---------------------------------------------------------------------------

#[test]
fn a_user_can_claim_once_per_cooldown() {
    let mut ctx = setup();
    init_faucet(&mut ctx, PER_CLAIM, COOLDOWN).expect("init_faucet");

    let (user, ata) = wallet(&mut ctx);
    assert_eq!(token_balance(&ctx.svm, &ata), 0);

    faucet_mint(&mut ctx, &user, &ata).expect("first claim");
    assert_eq!(token_balance(&ctx.svm, &ata), PER_CLAIM);

    let c = claim_state(&ctx, &user.pubkey());
    assert_eq!(c.user, user.pubkey());
    assert_eq!(c.total_claimed, PER_CLAIM);

    // Immediately again: refused.
    assert!(faucet_mint(&mut ctx, &user, &ata).is_err());

    // One second short of the cooldown: still refused.
    warp_to(&mut ctx.svm, c.last_claim_ts + COOLDOWN - 1);
    assert!(faucet_mint(&mut ctx, &user, &ata).is_err());

    // Exactly on the cooldown: allowed.
    warp_to(&mut ctx.svm, c.last_claim_ts + COOLDOWN);
    faucet_mint(&mut ctx, &user, &ata).expect("second claim");
    assert_eq!(token_balance(&ctx.svm, &ata), 2 * PER_CLAIM);
    assert_eq!(claim_state(&ctx, &user.pubkey()).total_claimed, 2 * PER_CLAIM);
}

#[test]
fn a_first_claim_at_timestamp_zero_is_still_one_claim() {
    // litesvm's clock starts at 0, and so does a freshly created account's
    // last_claim_ts. Keying "never claimed" off the timestamp would hand out
    // a free second claim here.
    let mut ctx = setup();
    init_faucet(&mut ctx, PER_CLAIM, COOLDOWN).unwrap();
    assert_eq!(now(&ctx.svm), 0);

    let (user, ata) = wallet(&mut ctx);
    faucet_mint(&mut ctx, &user, &ata).expect("first claim at t=0");
    assert!(
        faucet_mint(&mut ctx, &user, &ata).is_err(),
        "t=0 is a real timestamp, not 'never claimed'"
    );
    assert_eq!(token_balance(&ctx.svm, &ata), PER_CLAIM);
}

#[test]
fn cooldowns_are_per_user() {
    let mut ctx = setup();
    init_faucet(&mut ctx, PER_CLAIM, COOLDOWN).unwrap();

    let (alice, alice_ata) = wallet(&mut ctx);
    let (bob, bob_ata) = wallet(&mut ctx);

    faucet_mint(&mut ctx, &alice, &alice_ata).unwrap();
    assert!(faucet_mint(&mut ctx, &alice, &alice_ata).is_err());

    // Alice draining her allowance must not affect Bob.
    faucet_mint(&mut ctx, &bob, &bob_ata).expect("bob is unaffected");
    assert_eq!(token_balance(&ctx.svm, &bob_ata), PER_CLAIM);
}

#[test]
fn the_faucet_is_the_only_way_to_create_supply() {
    let mut ctx = setup();
    init_faucet(&mut ctx, PER_CLAIM, COOLDOWN).unwrap();
    let (user, ata) = wallet(&mut ctx);

    // The admin created the mint but handed authority to the PDA, so it
    // cannot mint directly any more.
    let admin = ctx.admin.insecure_clone();
    let ix = spl_token::instruction::mint_to(
        &spl_token::ID,
        &ctx.mint,
        &ata,
        &admin.pubkey(),
        &[],
        1_000_000 * USDX,
    )
    .unwrap();
    assert!(
        send(&mut ctx.svm, &admin, &[ix], &[&admin]).is_err(),
        "mint authority belongs to the faucet PDA, not the deployer"
    );

    faucet_mint(&mut ctx, &user, &ata).unwrap();
    assert_eq!(token_balance(&ctx.svm, &ata), PER_CLAIM);
}

#[test]
fn rejects_an_absurd_claim_size() {
    let mut ctx = setup();
    assert!(init_faucet(&mut ctx, 0, COOLDOWN).is_err());
    assert!(init_faucet(&mut ctx, u64::MAX, COOLDOWN).is_err());
    assert!(init_faucet(&mut ctx, PER_CLAIM, -1).is_err());
    init_faucet(&mut ctx, PER_CLAIM, COOLDOWN).expect("a sane one still works");
}

#[test]
fn a_zero_cooldown_faucet_never_blocks() {
    let mut ctx = setup();
    init_faucet(&mut ctx, PER_CLAIM, 0).unwrap();
    let (user, ata) = wallet(&mut ctx);

    faucet_mint(&mut ctx, &user, &ata).unwrap();
    faucet_mint(&mut ctx, &user, &ata).expect("no cooldown configured");
    assert_eq!(token_balance(&ctx.svm, &ata), 2 * PER_CLAIM);
}
