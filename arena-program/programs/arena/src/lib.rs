use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

pub mod candles;
pub mod oracle;
pub mod paper;
pub mod paper_llm;
pub mod state;
pub mod strategy;

use state::*;

declare_id!("6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC"); // replaced after first deploy

pub const CONFIG_SEED: &[u8] = b"config";
pub const MARKET_SEED: &[u8] = b"market";
pub const BOT_SEED: &[u8] = b"bot";
pub const LLM_BOT_SEED: &[u8] = b"llmbot";
pub const CRANK_PAYER_SEED: &[u8] = b"crank-payer";

// apply_decision action codes (the off-chain brain encodes its decision).
pub const DECISION_HOLD: u8 = 0;
pub const DECISION_OPEN: u8 = 1;
pub const DECISION_CLOSE: u8 = 2;

#[ephemeral]
#[program]
pub mod arena {
    use super::*;

    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        Ok(())
    }

    pub fn init_config(
        ctx: Context<InitConfig>,
        fee_bps: u16,
        spread_bps: u16,
        maint_buffer_bps: u16,
        max_age_secs: i64,
        bucket_secs: i64,
    ) -> Result<()> {
        require!(max_age_secs > 0, ArenaError::BadParams);
        require!(bucket_secs > 0, ArenaError::BadParams);
        // paper.rs computes BPS - maint_buffer_bps and BPS - spread haircuts;
        // keep every bps knob strictly inside the domain.
        require!((fee_bps as u64) < BPS, ArenaError::BadParams);
        require!((spread_bps as u64) < BPS, ArenaError::BadParams);
        require!((maint_buffer_bps as u64) < BPS, ArenaError::BadParams);
        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.payer.key();
        cfg.fee_bps = fee_bps;
        cfg.spread_bps = spread_bps;
        cfg.maint_buffer_bps = maint_buffer_bps;
        cfg.max_age_secs = max_age_secs;
        cfg.bucket_secs = bucket_secs;
        cfg.markets = [MarketCfg::default(); MAX_MARKETS];
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn init_market(ctx: Context<InitMarket>, market_id: u8, feed: Pubkey) -> Result<()> {
        require!((market_id as usize) < MAX_MARKETS, ArenaError::UnknownMarket);
        let cfg = &mut ctx.accounts.config;
        cfg.markets[market_id as usize] = MarketCfg {
            market_id,
            feed,
            active: true,
        };
        // load_init: writes the discriminator; the fresh account data is
        // already zeroed, so every other field starts at its zero value.
        let ms = &mut ctx.accounts.market_state.load_init()?;
        ms.market_id = market_id;
        ms.bump = ctx.bumps.market_state;
        Ok(())
    }

    pub fn init_bot(
        ctx: Context<InitBot>,
        persona_id: [u8; 16],
        params: StrategyParams,
        starting_balance_micro: u64,
    ) -> Result<()> {
        require!(
            params.read_span == 1 || params.read_span == 4,
            ArenaError::BadParams
        );
        require!(params.leverage >= 1, ArenaError::BadParams);
        require!(params.stake_frac_bps <= 10_000, ArenaError::BadParams);
        // max_hold_ticks == 0 would close every position on the tick after
        // open (paper::maintain checks ticks_held >= max_hold_ticks).
        require!(params.max_hold_ticks >= 1, ArenaError::BadParams);
        let bot = &mut ctx.accounts.bot.load_init()?;
        bot.persona_id = persona_id;
        bot.params = params;
        bot.balance_micro = starting_balance_micro;
        bot.equity_high_micro = starting_balance_micro;
        bot.bump = ctx.bumps.bot;
        Ok(())
    }

    /// Base-layer instruction: create an LLM oracle-bot account. The `operator`
    /// pubkey is the ONLY key allowed to submit this bot's decisions
    /// (apply_decision); the off-chain LLM brain holds it. Admin-gated; every
    /// safety-floor knob is validated to its domain so the floor can never be
    /// initialized into a nonsensical state.
    pub fn init_llm_bot(
        ctx: Context<InitLlmBot>,
        persona_id: [u8; 16],
        operator: Pubkey,
        params: LlmParams,
        starting_balance_micro: u64,
    ) -> Result<()> {
        require!(params.max_leverage >= 1, ArenaError::BadParams);
        require!(params.max_stake_frac_bps <= 10_000, ArenaError::BadParams);
        require!(
            params.min_stop_bps >= 1 && params.min_stop_bps <= params.max_stop_bps,
            ArenaError::BadParams
        );
        require!((params.max_stop_bps as u64) < BPS, ArenaError::BadParams);
        require!((params.daily_loss_limit_bps as u64) <= BPS, ArenaError::BadParams);
        require!(params.confidence_floor <= 100, ArenaError::BadParams);
        require!(params.risk_sizing <= 1, ArenaError::BadParams);
        require!(params.max_hold_ticks >= 1, ArenaError::BadParams);
        let bot = &mut ctx.accounts.llm_bot.load_init()?;
        bot.operator = operator;
        bot.persona_id = persona_id;
        bot.params = params;
        bot.balance_micro = starting_balance_micro;
        bot.equity_high_micro = starting_balance_micro;
        bot.day_start_equity_micro = starting_balance_micro;
        // day_start_ts stays 0 → the first roll_day (crank or apply_decision)
        // stamps the real day boundary.
        bot.bump = ctx.bumps.llm_bot;
        Ok(())
    }

    /// Permissionless crank tick for one market: read the oracle feed, fold
    /// the price into the candle ring, then for each Bot in
    /// remaining_accounts run maintenance (liq / favorable / max-hold exits)
    /// and the open decision. Fail-closed: a stale or malformed feed is a
    /// successful no-op — the arena pauses honestly instead of trading on
    /// bad data. A feed print no newer than the last folded one is likewise
    /// a successful no-op (spam-aging guard): candle and bot state only
    /// advance when the oracle has actually published a NEWER price, so
    /// spam ticks between oracle pushes cannot age positions. Tape entries
    /// record conviction 0 (conviction is not modeled in Phase 1).
    pub fn tick(ctx: Context<Tick>, market_id: u8) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let mcfg = cfg
            .markets
            .iter()
            .find(|m| m.active && m.market_id == market_id)
            .ok_or(ArenaError::UnknownMarket)?;
        require_keys_eq!(ctx.accounts.feed.key(), mcfg.feed, ArenaError::WrongFeed);

        let now = Clock::get()?.unix_timestamp;
        let read = {
            let data = ctx.accounts.feed.try_borrow_data()?;
            oracle::read_feed(&data, now, cfg.max_age_secs)
        };
        let Some(read) = read else {
            return Ok(()); // stale/malformed feed → no-op success
        };

        let ms = &mut *ctx.accounts.market_state.load_mut()?;
        // Spam-aging guard (pre-mainnet gate, review Issue 2): a print at or
        // before the last folded publish_ts advances NOTHING — same no-op
        // success style as the stale-feed guard above. Without it, anyone
        // could call tick in a tight loop: each call would re-fold the same
        // print (updates/path_len churn) and, worse, run paper maintenance,
        // aging every open position via ticks_held so max_hold_ticks
        // personas decay on attacker-paid ticks.
        if read.publish_ts <= ms.last_publish_ts {
            return Ok(()); // no new oracle print → no-op success
        }
        candles::fold_price(ms, read.price, read.publish_ts, cfg.bucket_secs);

        // Bots ride in remaining_accounts. AccountLoader::try_from checks
        // owner + discriminator; load_mut additionally requires the account
        // writable and maps the bytes in place — zero_copy means there is no
        // stack deserialize frame and no `.exit()` re-serialize: writes land
        // directly in account memory when the RefMut drops.
        // remaining_accounts may hold deterministic Bot accounts AND LLM
        // oracle-bot LlmBot accounts. Bot runs the in-program strategy; LlmBot
        // runs ONLY the deterministic safety floor (funding / stop / tp / liq /
        // max-hold / kill-switch) — its entries/exits come from apply_decision,
        // never from in-program logic. Try each loader; fail loudly on anything
        // that is neither (the crank controls this list).
        for acc in ctx.remaining_accounts {
            if let Ok(loader) = AccountLoader::<Bot>::try_from(acc) {
                let bot = &mut *loader.load_mut()?;
                paper::maintain(bot, cfg, market_id, read.price, now);
                let span = bot.params.read_span as usize;
                let candles = candles::complete_candles(ms, span, MIN_STRAT_CANDLES);
                if let Some(side) = strategy::decide_ring_momentum(&candles, &bot.params) {
                    paper::try_open(bot, cfg, market_id, side, read.price, now);
                }
            } else if let Ok(loader) = AccountLoader::<LlmBot>::try_from(acc) {
                let bot = &mut *loader.load_mut()?;
                paper_llm::roll_day(bot, now);
                paper_llm::maintain_llm(bot, cfg, market_id, read.price, now);
            } else {
                return Err(ArenaError::UnknownAccount.into());
            }
        }
        Ok(())
    }

    /// ER instruction: apply one LLM decision to an LlmBot. Signed by the
    /// bot's `operator` (the off-chain brain). The program is the final
    /// authority: it reads the verified oracle price for the fill, enforces the
    /// safety floor in code (paper_llm::precheck_open clamps leverage/stake and
    /// rejects on halt / cooldown / trade-cap / missing-or-out-of-range stop),
    /// then applies the paper open/close. The operator can only choose timing
    /// and direction — it cannot forge a price, exceed a limit, or trade past
    /// the kill switch. The deterministic stop/liq/funding/max-hold runs in
    /// `tick` (the crank) every ~2s, independent of this call.
    ///
    /// `action`: 0 HOLD (heartbeat) / 1 OPEN / 2 CLOSE. `side`: 0 long / 1 short
    /// (OPEN only). Fail-closed: a stale/malformed feed is a no-op success.
    pub fn apply_decision(
        ctx: Context<ApplyDecision>,
        market_id: u8,
        action: u8,
        side: u8,
        leverage: u16,
        stake_frac_bps: u16,
        stop_bps: u16,
        tp_bps: u16,
        confidence: u8,
    ) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let mcfg = cfg
            .markets
            .iter()
            .find(|m| m.active && m.market_id == market_id)
            .ok_or(ArenaError::UnknownMarket)?;
        require_keys_eq!(ctx.accounts.feed.key(), mcfg.feed, ArenaError::WrongFeed);

        let now = Clock::get()?.unix_timestamp;
        let read = {
            let data = ctx.accounts.feed.try_borrow_data()?;
            oracle::read_feed(&data, now, cfg.max_age_secs)
        };
        let Some(read) = read else {
            return Ok(()); // stale/malformed feed → no-op success
        };

        let bot = &mut *ctx.accounts.llm_bot.load_mut()?;
        require_keys_eq!(
            ctx.accounts.operator.key(),
            bot.operator,
            ArenaError::NotOperator
        );
        paper_llm::roll_day(bot, now);

        match action {
            DECISION_OPEN => {
                match paper_llm::precheck_open(
                    bot,
                    now,
                    leverage,
                    stake_frac_bps,
                    stop_bps,
                    tp_bps,
                    confidence,
                ) {
                    Ok(plan) => {
                        let s = if side == 0 {
                            strategy::Side::Long
                        } else {
                            strategy::Side::Short
                        };
                        paper_llm::apply_open(bot, cfg, market_id, s, read.price, now, plan);
                    }
                    // Low confidence is a soft "do nothing" (HOLD), not an error.
                    Err(paper_llm::FloorReject::LowConfidence) => {}
                    Err(paper_llm::FloorReject::Halted) => return Err(ArenaError::Halted.into()),
                    Err(paper_llm::FloorReject::Cooldown) => return Err(ArenaError::Cooldown.into()),
                    Err(paper_llm::FloorReject::TradeCap) => {
                        return Err(ArenaError::TradeCapReached.into())
                    }
                    Err(paper_llm::FloorReject::StopRequired) => {
                        return Err(ArenaError::StopRequired.into())
                    }
                }
            }
            DECISION_CLOSE => {
                if let Some(idx) = paper_llm::find_position_in_market(bot, market_id) {
                    paper_llm::apply_close(bot, cfg, idx, read.price, now, paper_llm::ACT_CLOSE_LLM);
                }
                // No open position in this market → benign no-op.
            }
            _ => {} // HOLD / unknown → heartbeat only
        }
        bot.last_decision_ts = now;
        Ok(())
    }

    /// Base-layer instruction: delegate one LlmBot PDA to the ER. Admin-gated.
    /// Validator pin via the first remaining account is mandatory, as for Bot.
    pub fn delegate_llm_bot(ctx: Context<DelegateLlmBot>, persona_id: [u8; 16]) -> Result<()> {
        require!(
            !ctx.remaining_accounts.is_empty(),
            ArenaError::MissingValidator
        );
        ctx.accounts.delegate_llm_bot_state(
            &ctx.accounts.admin,
            &[LLM_BOT_SEED, &persona_id],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Base-layer instruction: create the crank-payer PDA — a program-owned
    /// lamport reservoir that pays commit_state's Magic intent bundle once
    /// delegated (no per-account sponsored-commit quota on that path).
    /// Admin-gated. Mirrors the documented delegated-fee-payer pattern
    /// (delegation.md "Option 2" / rewards-delegated-vrf's reward_list):
    /// the payer is a regular program-owned data PDA, delegated like any
    /// other account; its lamports ride into the ER at delegation and are
    /// topped up afterwards via the base-layer lamports shuttle
    /// (scripts/arena/fund-crank-payer.ts).
    pub fn init_crank_payer(ctx: Context<InitCrankPayer>) -> Result<()> {
        ctx.accounts.crank_payer.bump = ctx.bumps.crank_payer;
        Ok(())
    }

    /// Base-layer instruction: delegate the crank-payer PDA to the ER so its
    /// lamports become the ER-side balance commit_state spends from.
    /// Admin-gated; validator pin via the first remaining account is
    /// mandatory (same rule as delegate_market/delegate_bot) — and here it
    /// also keeps the payer on the SAME validator as the market, which the
    /// fee vault derivation in commit_state assumes.
    pub fn delegate_crank_payer(ctx: Context<DelegateCrankPayer>) -> Result<()> {
        require!(
            !ctx.remaining_accounts.is_empty(),
            ArenaError::MissingValidator
        );
        ctx.accounts.delegate_crank_payer(
            &ctx.accounts.admin,
            &[CRANK_PAYER_SEED],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    // ---- ER delegation lifecycle (er-sdk 0.14.3, anchor-counter patterns) --

    /// Base-layer instruction: delegate the MarketState PDA to the ER.
    /// Admin-gated. The ER validator identity is pinned via the first
    /// remaining account (spec gotcha: never delegate without pinning) —
    /// MANDATORY: forgetting it must fail loudly, not delegate unpinned.
    pub fn delegate_market(ctx: Context<DelegateMarket>, market_id: u8) -> Result<()> {
        require!(
            !ctx.remaining_accounts.is_empty(),
            ArenaError::MissingValidator
        );
        ctx.accounts.delegate_market_state(
            &ctx.accounts.admin,
            &[MARKET_SEED, &[market_id]],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Base-layer instruction: delegate one Bot PDA to the ER. Admin-gated.
    /// Validator pin via the first remaining account is mandatory, as above.
    pub fn delegate_bot(ctx: Context<DelegateBot>, persona_id: [u8; 16]) -> Result<()> {
        require!(
            !ctx.remaining_accounts.is_empty(),
            ArenaError::MissingValidator
        );
        ctx.accounts.delegate_bot_state(
            &ctx.accounts.admin,
            &[BOT_SEED, &persona_id],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// ER instruction: persist the current ER state of the market (+ any Bot
    /// accounts passed as remaining_accounts) to the base layer WITHOUT
    /// undelegating. Deliberately permissionless: the crank keypair is not
    /// the admin (Task 14), and a commit can only persist state, never
    /// mutate it — the magic program rejects non-delegated accounts anyway.
    /// (Accepted cost of staying permissionless: each commit drips lamports
    /// from the crank-payer PDA, so a spammer can drain it at the per-commit
    /// fee rate. Reviewed + accepted — the arena then merely stops
    /// persisting until refunded; ER state is unaffected.)
    ///
    /// Pays its own commit via the magic_fee_vault + delegated-fee-payer
    /// pattern (delegation.md "Option 2"): the bundle payer is the delegated
    /// crank-payer PDA signing via seeds, with the validator's fee vault
    /// attached, which lifts MagicBlock's 10-sponsored-commits-per-account
    /// quota (the 0xa0000000 "commit nonce 10/10" failure mode).
    ///
    /// ONE intent per account (MagicBlock-confirmed root cause of the
    /// 2026-06-12 wedge): the validator finalizes each intent as a single
    /// base-layer transaction touching every account in the bundle, and a
    /// 3-account bundle already exceeds the base-layer compute budget —
    /// the commit-intent tx fails on ComputationalBudget and retries
    /// forever. Per-account intents keep every finalize tx minimal.
    pub fn commit_state<'info>(
        ctx: Context<'info, CommitState<'info>>,
        _market_id: u8,
    ) -> Result<()> {
        // The fee vault is scoped to the validator running the ER. Read the
        // validator out of market_state's delegation record — layout
        // [8 discriminator][32 authority = validator][..] — and require the
        // passed vault to be the canonical ["magic-fee-vault", validator]
        // PDA under the delegation program. The record's own address is
        // pinned by the account constraint, so its bytes are trustworthy.
        let validator = {
            let record = ctx.accounts.delegation_record.try_borrow_data()?;
            require!(record.len() >= 40, ArenaError::InvalidDelegationRecord);
            Pubkey::try_from(&record[8..40])
                .map_err(|_| error!(ArenaError::InvalidDelegationRecord))?
        };
        let (expected_fee_vault, _) = Pubkey::find_program_address(
            &[b"magic-fee-vault", validator.as_ref()],
            &ephemeral_rollups_sdk::id(),
        );
        require_keys_eq!(
            ctx.accounts.magic_fee_vault.key(),
            expected_fee_vault,
            ArenaError::InvalidFeeVault
        );

        // One builder per account: each build_and_invoke_signed is one CPI
        // to the magic program scheduling one independent single-account
        // intent. Defensive CU note: measured on the local ER harness,
        // 3 intents in this one instruction consumed ~109k CU (~36k per
        // intent) against the default 200k/ix budget — fine at our
        // N = market + 2-4 bots, but at ~5 accounts this instruction nears
        // its own ceiling. If the roster grows past that, fall back to
        // commit_state taking an account_index and the crank invoking it
        // once per account in separate ER txs.
        let mut accounts = vec![ctx.accounts.market_state.to_account_info()];
        accounts.extend(ctx.remaining_accounts.iter().cloned());
        let crank_payer_seeds: &[&[u8]] =
            &[CRANK_PAYER_SEED, &[ctx.bumps.crank_payer]];
        for account in accounts {
            MagicIntentBundleBuilder::new(
                ctx.accounts.crank_payer.to_account_info(),
                ctx.accounts.magic_context.to_account_info(),
                ctx.accounts.magic_program.to_account_info(),
            )
            .magic_fee_vault(ctx.accounts.magic_fee_vault.to_account_info())
            .commit(&[account])
            .build_and_invoke_signed(&[crank_payer_seeds])?;
        }
        Ok(())
    }

    /// ER instruction: commit AND undelegate the market (+ remaining Bot
    /// accounts) back to the base layer. Admin-gated — an unwanted
    /// undelegation halts the arena until re-delegation. (The config PDA is
    /// not delegated; the ER serves it as a read-only clone from the base
    /// layer, which the local ephemeral harness exercises.)
    ///
    /// ONE intent per account, same as commit_state: the multi-account
    /// commit_and_undelegate bundle is the exact call that wedged the
    /// 2026-06-12 undelegation — its single base-layer finalize tx for all
    /// 3 accounts failed on ComputationalBudget and retried forever
    /// (MagicBlock-confirmed). Per-account intents undelegate each account
    /// in its own base-layer tx; accounts therefore flip back to the
    /// program independently rather than atomically, which the admin-only
    /// redelegate flow already tolerates (it polls every account).
    pub fn undelegate_all<'info>(
        ctx: Context<'info, UndelegateAll<'info>>,
        _market_id: u8,
    ) -> Result<()> {
        let mut accounts = vec![ctx.accounts.market_state.to_account_info()];
        accounts.extend(ctx.remaining_accounts.iter().cloned());
        for account in accounts {
            MagicIntentBundleBuilder::new(
                ctx.accounts.admin.to_account_info(),
                ctx.accounts.magic_context.to_account_info(),
                ctx.accounts.magic_program.to_account_info(),
            )
            .commit_and_undelegate(&[account])
            .build_and_invoke()?;
        }
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping {}

// SBF stack caveat (PINS.md, "Task 10 BLOCKED"): MarketState / Bot are
// zero_copy and MUST be accessed via AccountLoader — their Borsh deserialize
// frames (7232 B / 4608 B) blow the 4096-byte SBF stack limit, and Boxing
// does not help because the overflow is in the callee
// try_deserialize_unchecked frame. ArenaConfig (8 + 327 B) stays a regular
// Borsh Account; it is Boxed only to keep the Accounts-struct frames small.
#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + ArenaConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Box<Account<'info, ArenaConfig>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(market_id: u8)]
pub struct InitMarket<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ ArenaError::Unauthorized
    )]
    pub config: Box<Account<'info, ArenaConfig>>,
    #[account(
        init,
        payer = admin,
        space = 8 + std::mem::size_of::<MarketState>(),
        seeds = [MARKET_SEED, &[market_id]],
        bump
    )]
    pub market_state: AccountLoader<'info, MarketState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(persona_id: [u8; 16])]
pub struct InitBot<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ ArenaError::Unauthorized
    )]
    pub config: Box<Account<'info, ArenaConfig>>,
    #[account(
        init,
        payer = admin,
        space = 8 + std::mem::size_of::<Bot>(),
        seeds = [BOT_SEED, &persona_id],
        bump
    )]
    pub bot: AccountLoader<'info, Bot>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(market_id: u8)]
pub struct Tick<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ArenaConfig>>,
    #[account(
        mut,
        seeds = [MARKET_SEED, &[market_id]],
        bump = market_state.load()?.bump
    )]
    pub market_state: AccountLoader<'info, MarketState>,
    /// CHECK: handler enforces address == config.markets[market_id].feed
    /// (require_keys_eq → WrongFeed); oracle::read_feed parses the data
    /// defensively and fails closed on anything malformed.
    pub feed: UncheckedAccount<'info>,
}

// Delegation contexts hold the PDAs as UncheckedAccount exactly like
// anchor-counter's DelegateInput (its `pda` IS an UncheckedAccount):
// delegation operates at the AccountInfo level, so the zero_copy
// serialization format is irrelevant and AccountLoader types would only
// fight the er-sdk `del` macro for no benefit. Seeds are still PDA-checked.
#[delegate]
#[derive(Accounts)]
#[instruction(market_id: u8)]
pub struct DelegateMarket<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ ArenaError::Unauthorized
    )]
    pub config: Box<Account<'info, ArenaConfig>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: PDA address enforced by seeds; handed to the delegation
    /// program via the er-sdk `del` constraint.
    #[account(mut, del, seeds = [MARKET_SEED, &[market_id]], bump)]
    pub market_state: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(persona_id: [u8; 16])]
pub struct DelegateBot<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ ArenaError::Unauthorized
    )]
    pub config: Box<Account<'info, ArenaConfig>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: PDA address enforced by seeds; handed to the delegation
    /// program via the er-sdk `del` constraint.
    #[account(mut, del, seeds = [BOT_SEED, &persona_id], bump)]
    pub bot_state: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(persona_id: [u8; 16])]
pub struct InitLlmBot<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ ArenaError::Unauthorized
    )]
    pub config: Box<Account<'info, ArenaConfig>>,
    #[account(
        init,
        payer = admin,
        space = 8 + std::mem::size_of::<LlmBot>(),
        seeds = [LLM_BOT_SEED, &persona_id],
        bump
    )]
    pub llm_bot: AccountLoader<'info, LlmBot>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// apply_decision needs no market_state: the LLM decided off-chain; the program
// only needs the verified feed price for the fill. config is served as a
// read-only clone on the ER (same as tick). Authority is the operator signer
// checked against llm_bot.operator in the handler; AccountLoader already
// enforces owner + LlmBot discriminator, so a fake or foreign account is
// rejected before the operator check.
#[derive(Accounts)]
#[instruction(market_id: u8)]
pub struct ApplyDecision<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ArenaConfig>>,
    /// CHECK: handler enforces address == config.markets[market_id].feed
    /// (require_keys_eq → WrongFeed); oracle::read_feed parses defensively.
    pub feed: UncheckedAccount<'info>,
    #[account(mut)]
    pub llm_bot: AccountLoader<'info, LlmBot>,
    pub operator: Signer<'info>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(persona_id: [u8; 16])]
pub struct DelegateLlmBot<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ ArenaError::Unauthorized
    )]
    pub config: Box<Account<'info, ArenaConfig>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: PDA address enforced by seeds; handed to the delegation
    /// program via the er-sdk `del` constraint. Field named `llm_bot_state` so
    /// the macro method is `delegate_llm_bot_state` (distinct from the handler).
    #[account(mut, del, seeds = [LLM_BOT_SEED, &persona_id], bump)]
    pub llm_bot_state: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct InitCrankPayer<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ ArenaError::Unauthorized
    )]
    pub config: Box<Account<'info, ArenaConfig>>,
    #[account(
        init,
        payer = admin,
        space = 8 + CrankPayer::INIT_SPACE,
        seeds = [CRANK_PAYER_SEED],
        bump
    )]
    pub crank_payer: Account<'info, CrankPayer>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateCrankPayer<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ ArenaError::Unauthorized
    )]
    pub config: Box<Account<'info, ArenaConfig>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: PDA address enforced by seeds; handed to the delegation
    /// program via the er-sdk `del` constraint.
    #[account(mut, del, seeds = [CRANK_PAYER_SEED], bump)]
    pub crank_payer: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
#[instruction(market_id: u8)]
pub struct CommitState<'info> {
    /// ER transaction gas payer (any keypair). The Magic intent bundle
    /// itself is paid by crank_payer below, not this signer.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, &[market_id]],
        bump = market_state.load()?.bump
    )]
    pub market_state: AccountLoader<'info, MarketState>,
    /// CHECK: market_state's delegation record — address pinned to the
    /// canonical ["delegation", market_state] PDA under the delegation
    /// program; the handler reads the validator from bytes 8..40 to derive
    /// the expected fee vault.
    #[account(
        address = ephemeral_rollups_sdk::pda::delegation_record_pda_from_delegated_account(&market_state.key())
            @ ArenaError::InvalidDelegationRecord
    )]
    pub delegation_record: UncheckedAccount<'info>,
    /// CHECK: the validator's magic fee vault, validated in the handler
    /// against the delegation record's validator. Writable: lamports are
    /// debited on each paid commit.
    #[account(mut)]
    pub magic_fee_vault: UncheckedAccount<'info>,
    /// CHECK: PDA address enforced by seeds. The delegated bundle payer —
    /// the program signs the Magic CPI with its seeds
    /// (build_and_invoke_signed), so no keypair signature is needed.
    /// UncheckedAccount because on the ER its owner shows as this program
    /// (delegated clone) while the lamport-payer role needs no data access.
    #[account(mut, seeds = [CRANK_PAYER_SEED], bump)]
    pub crank_payer: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
#[instruction(market_id: u8)]
pub struct UndelegateAll<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ ArenaError::Unauthorized
    )]
    pub config: Box<Account<'info, ArenaConfig>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, &[market_id]],
        bump = market_state.load()?.bump
    )]
    pub market_state: AccountLoader<'info, MarketState>,
}

#[error_code]
pub enum ArenaError {
    #[msg("signer does not match the config admin")]
    Unauthorized,
    #[msg("parameter outside the accepted domain")]
    BadParams,
    #[msg("unknown or inactive market id")]
    UnknownMarket,
    #[msg("feed account does not match the market config")]
    WrongFeed,
    #[msg("delegation requires the ER validator pinned as the first remaining account")]
    MissingValidator,
    #[msg("delegation record missing, malformed, or not the canonical PDA")]
    InvalidDelegationRecord,
    #[msg("magic fee vault does not match the delegation record's validator")]
    InvalidFeeVault,
    #[msg("signer is not the bot operator")]
    NotOperator,
    #[msg("bot halted by the daily-loss kill switch")]
    Halted,
    #[msg("decision cooldown has not elapsed")]
    Cooldown,
    #[msg("daily trade cap reached")]
    TradeCapReached,
    #[msg("open decision requires a stop loss")]
    StopRequired,
    #[msg("unknown account type in remaining_accounts")]
    UnknownAccount,
}
