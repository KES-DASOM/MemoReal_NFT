use anchor_lang::prelude::*;

declare_id!("9sEBnNzja3frQmiU6DBqfn69xMaJSSDdPaPq5GvBhSjQ");

#[program]
pub mod memoreal_nft_proj {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
