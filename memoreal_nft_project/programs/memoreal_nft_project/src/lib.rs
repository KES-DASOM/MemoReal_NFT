use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, MintTo, mint_to};
use solana_program_option::COption;

declare_id!("4qcHeUMS7H8nXm1n6c2fgGmoSmubUaETVAq1nmFPYxeq");

#[program]
pub mod memoreal_nft_project {
    use super::*;

    pub fn create_capsule(
        ctx: Context<CreateCapsule>,
        title: String,
        recipient: String,
        message: String,
        media_url: String,
        capsule_type: CapsuleType,
        unlock_at: Option<i64>,
        location: Option<String>,
    ) -> Result<()> {
        let capsule = &mut ctx.accounts.capsule;

        capsule.author = ctx.accounts.author.key();
        capsule.title = title;
        capsule.recipient = recipient;
        capsule.message = message;
        capsule.media_url = media_url;
        capsule.created_at = Clock::get()?.unix_timestamp;
        capsule.capsule_type = capsule_type;
        capsule.unlock_at = unlock_at;
        capsule.location = location;

        Ok(())
    }

    pub fn mint_nft(ctx: Context<MintNFT>) -> Result<()> {
        require!(
            ctx.accounts.mint.mint_authority == COption::Some(ctx.accounts.author.key()),
            CustomError::InvalidMintAuthority
        );
        
        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.token_account.to_account_info(),
            authority: ctx.accounts.author.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        mint_to(cpi_ctx, 1)?;
        Ok(())
    }
    
    #[error_code]
    pub enum CustomError {
        #[msg("Mint authority mismatch.")]
        InvalidMintAuthority,
    }

    pub fn is_unlockable(ctx: Context<CheckUnlock>) -> Result<bool> {
        let capsule = &ctx.accounts.capsule;
        let now = Clock::get()?.unix_timestamp;

        match capsule.capsule_type {
            CapsuleType::General => Ok(true), // 일반 캡슐은 언제든지 열 수 있음
            CapsuleType::TimeLocked => {
                if let Some(unlock_at) = capsule.unlock_at {
                    Ok(now >= unlock_at) // 타임락 캡슐은 설정된 시간 이후에만 열 수 있음
                } else {
                    Ok(false)
                }
            }
        }
    }
}

#[derive(Accounts)]
pub struct CreateCapsule<'info> {
    #[account(init, payer = author, space = CapsuleMetadata::LEN)]
    pub capsule: Account<'info, CapsuleMetadata>,

    #[account(mut)]
    pub author: Signer<'info>,

    pub system_program: Program<'info, System>,
}



#[derive(Accounts)]
pub struct MintNFT<'info> {
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>, 

    pub author: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CheckUnlock<'info> {
    pub capsule: Account<'info, CapsuleMetadata>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum CapsuleType {
    General,
    TimeLocked,
}

#[account]
pub struct CapsuleMetadata {
    pub author: Pubkey,             // 작성자 지갑 주소
    pub title: String,              // 제목
    pub recipient: String,          // 수신자 이름
    pub message: String,            // 메세지
    pub media_url: String,          // 사진 또는 영상(IPFS 링크)
    pub created_at: i64,            // 생성 시간 (Unix timestamp)
    pub capsule_type: CapsuleType,  // 캡슐 종류
    pub unlock_at: Option<i64>,     // (선택) 타임락 해제 시간
    pub location: Option<String>,   // (선택) 위치 정보
}

impl CapsuleMetadata {
    pub const LEN: usize = 8          // discriminator
        + 32                          // author
        + 4 + 64                      // title
        + 4 + 64                      // recipient
        + 4 + 256                     // message
        + 4 + 256                     // media_url
        + 8                           // created_at
        + 1                           // capsule_type
        + 1 + 8                       // unlock_at (Option<i64>)
        + 1 + 4 + 64;                 // location (Option<String>)
}

