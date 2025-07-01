use anchor_lang::prelude::*;

declare_id!("3fvLRfGFfAYRb28v8C7r2WgpFCUBkcUHZdsvq5fEuEQ3");

#[program]
pub mod memoreal_nft_project {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
