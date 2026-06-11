use anchor_lang::prelude::*;

pub mod candles;
pub mod state;

declare_id!("6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC"); // replaced after first deploy

#[program]
pub mod arena {
    use super::*;
    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping {}
