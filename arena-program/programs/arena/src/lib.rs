use anchor_lang::prelude::*;

pub mod candles;
pub mod oracle;
pub mod paper;
pub mod state;
pub mod strategy;

use state::*;

declare_id!("6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC"); // replaced after first deploy

pub const CONFIG_SEED: &[u8] = b"config";
pub const MARKET_SEED: &[u8] = b"market";
pub const BOT_SEED: &[u8] = b"bot";

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

    /// Permissionless crank tick for one market: read the oracle feed, fold
    /// the price into the candle ring, then for each Bot in
    /// remaining_accounts run maintenance (liq / favorable / max-hold exits)
    /// and the open decision. Fail-closed: a stale or malformed feed is a
    /// successful no-op — the arena pauses honestly instead of trading on
    /// bad data. Tape entries record conviction 0 (conviction is not modeled
    /// in Phase 1).
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
        candles::fold_price(ms, read.price, read.publish_ts, cfg.bucket_secs);

        // Bots ride in remaining_accounts. AccountLoader::try_from checks
        // owner + discriminator; load_mut additionally requires the account
        // writable and maps the bytes in place — zero_copy means there is no
        // stack deserialize frame and no `.exit()` re-serialize: writes land
        // directly in account memory when the RefMut drops.
        for acc in ctx.remaining_accounts {
            let loader = AccountLoader::<Bot>::try_from(acc)?;
            let bot = &mut *loader.load_mut()?;
            paper::maintain(bot, cfg, market_id, read.price, now);
            let span = bot.params.read_span as usize;
            let candles = candles::complete_candles(ms, span, MIN_STRAT_CANDLES);
            if let Some(side) = strategy::decide_ring_momentum(&candles, &bot.params) {
                paper::try_open(bot, cfg, market_id, side, read.price, now);
            }
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
}
