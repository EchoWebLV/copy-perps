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
        let ms = &mut ctx.accounts.market_state;
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
        let bot = &mut ctx.accounts.bot;
        bot.persona_id = persona_id;
        bot.params = params;
        bot.balance_micro = starting_balance_micro;
        bot.equity_high_micro = starting_balance_micro;
        bot.bump = ctx.bumps.bot;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping {}

// SBF stack caveat (PINS.md, Tasks 6–9): MarketState / Bot Borsh-deserialize
// frames blow the 4096-byte SBF stack limit when the Account value lives on
// the stack. Every Accounts struct therefore Boxes these accounts (ArenaConfig
// too, for uniformity) so Anchor deserializes onto the heap.
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
        space = 8 + MarketState::INIT_SPACE,
        seeds = [MARKET_SEED, &[market_id]],
        bump
    )]
    pub market_state: Box<Account<'info, MarketState>>,
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
        space = 8 + Bot::INIT_SPACE,
        seeds = [BOT_SEED, &persona_id],
        bump
    )]
    pub bot: Box<Account<'info, Bot>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
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
