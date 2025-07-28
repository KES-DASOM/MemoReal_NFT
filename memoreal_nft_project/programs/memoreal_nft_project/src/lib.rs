use anchor_lang::prelude::*;
use anchor_spl::token::{
    Mint, Token, TokenAccount, MintTo, mint_to
};
use mpl_token_metadata::{
    types::{Creator, TokenStandard, PrintSupply},
    ID as METAPLEX_PROGRAM_ID,
    instructions::{
        CreateV1,
        CreateV1InstructionArgs
    },
};
use anchor_lang::solana_program::{
    program::invoke,
    sysvar,
    pubkey::Pubkey,
    system_program,
};

declare_id!("3AZ5UigWzJe3kbY6auiREHiyKs4EXw8WaWKASdNH2hkE");

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

        // 데이터 길이 검증
        require!(title.len() <= 64, CustomError::TitleTooLong);
        require!(message.len() <= 256, CustomError::MessageTooLong);
        require!(media_url.len() <= 256, CustomError::MediaUrlTooLong);
        require!(recipient.len() <= 64, CustomError::RecipientTooLong);
        if let Some(loc) = &location {
            require!(loc.len() <= 64, CustomError::LocationTooLong);
        }

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

    pub fn mint_nft(
        ctx: Context<MintNFT>,
        nft_name: String,
        nft_symbol: String,
        nft_uri: String, // IPFS 링크
    ) -> Result<()> {
        require!(
            ctx.accounts.mint.mint_authority == Some(ctx.accounts.author.key()).into(),
            CustomError::InvalidMintAuthority
        );
        
        // 1. SPL 토큰 발행
        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.token_account.to_account_info(),
            authority: ctx.accounts.author.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        mint_to(cpi_ctx, 1)?; // NFT는 1개 발행
        
        // 2. Metaplex Token Metadata 생성
        let creators = Box::new(Some(vec![
            Creator {
                address: ctx.accounts.author.key(),
                verified: true,
                share: 100, // 작성자가 100% 소유
            }
        ]));

        let metadata_args = Box::new(CreateV1InstructionArgs {
            name: nft_name,
            symbol: nft_symbol,
            uri: nft_uri,
            seller_fee_basis_points: 0,
            creators: *creators,
            collection: None,
            uses: None,
            collection_details: None,
            rule_set: None,
            decimals: Some(0),
            is_mutable: true,
            primary_sale_happened: false,
            token_standard: TokenStandard::NonFungible,
            print_supply: Some(PrintSupply::Zero),
        });

        // CreateV1 instruction 생성
        let create_ix = CreateV1 {
            metadata: ctx.accounts.metadata_account.key(),
            master_edition: None,
            mint: (ctx.accounts.mint.key(), true),
            authority: ctx.accounts.author.key(),
            payer: ctx.accounts.author.key(),
            update_authority: (ctx.accounts.author.key(), true),
            system_program: system_program::ID,
            sysvar_instructions: sysvar::instructions::ID,
            spl_token_program: Some(anchor_spl::token::ID), // anchor_spl 사용
        }.instruction(*metadata_args);

        // CPI 호출을 위한 AccountInfo 벡터 구성 (문서의 계정 순서 및 필요 계정 명확화)
        // CreateV1 Accounts:
        // 1. metadata: Unallocated metadata account with address as pda of ['metadata', program id, mint id]
        // 2. master_edition: Unallocated edition account with address as pda of ['metadata', program id, mint, 'edition'] (Option<Pubkey>)
        // 3. mint: Mint of token asset (Pubkey, bool)
        // 4. authority: Mint authority (Pubkey)
        // 5. payer: Payer (Pubkey)
        // 6. update_authority: Update authority for the metadata account (Pubkey, bool)
        // 7. system_program: System program (Pubkey)
        // 8. sysvar_instructions: Instructions sysvar account (Pubkey)
        // 9. spl_token_program: SPL Token program (Pubkey)
        
        // 계정 정보 구성
        let account_infos = vec![
            ctx.accounts.metadata_account.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.author.to_account_info(),
            ctx.accounts.author.to_account_info(),
            ctx.accounts.author.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.sysvar_instructions.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.token_metadata_program.to_account_info(),
        ];

        // master_edition이 None이므로, account_infos에 포함하지 않습니다.

        // invoke 함수를 사용하여 CPI 호출
        invoke(&create_ix, &account_infos)?;

        Ok(())
    }

    pub fn view_capsule(ctx: Context<CheckUnlock>, current_location: Option<String>) -> Result<CapsuleMetadata> {
        let capsule = &ctx.accounts.capsule;
        let now = Clock::get()?.unix_timestamp;

        // 일반 캡슐은 항상 열림
        if capsule.capsule_type == CapsuleType::General {
            return Ok(capsule.clone().into_inner());
        }

        // 시간 조건 확인
        let time_condition_met = 
        if let Some(unlock_at) = capsule.unlock_at {
            now >= unlock_at
        } else {
            false
        };

        // 위치 조건 확인
        let location_condition_met = match (&capsule.location, &current_location) {
            (Some(stored_loc), Some(input_loc)) => {
                *stored_loc == *input_loc
            },
            _ => true
        };

        if !time_condition_met {
            return Err(error!(CustomError::CapsuleLocked));
        }
        if !location_condition_met {
            return Err(error!(CustomError::LocationMismatch));
        }

        Ok(capsule.clone().into_inner())
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
    pub mint: Box<Account<'info, Mint>>, // Box로 감싸기
    #[account(mut)]
    pub token_account: Box<Account<'info, TokenAccount>>, // Box로 감싸기
    #[account(mut)]
    pub author: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"metadata",
            METAPLEX_PROGRAM_ID.as_ref(),
            mint.key().as_ref()
        ],
        bump,
        seeds::program = METAPLEX_PROGRAM_ID,
    )]
    /// CHECK: 메타플렉스 메타데이터 계정
    pub metadata_account: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    
    /// CHECK: 메타플렉스 토큰 메타데이터 프로그램 ID
    #[account(address = METAPLEX_PROGRAM_ID)]
    pub token_metadata_program: AccountInfo<'info>,

    /// CHECK: Instructions sysvar 계정
    #[account(address = sysvar::instructions::ID)]
    pub sysvar_instructions: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CheckUnlock<'info> {
    pub capsule: Box<Account<'info, CapsuleMetadata>>, // Box로 감싸기
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum CapsuleType {
    General,
    TimeLocked,
}

#[account]
pub struct CapsuleMetadata {
    pub author: Pubkey,            // 작성자 지갑 주소
    pub title: String,             // 제목
    pub recipient: String,         // 수신자 이름
    pub message: String,           // 메세지
    pub media_url: String,         // 사진 또는 영상(IPFS 링크)
    pub created_at: i64,           // 생성 시간 (Unix timestamp)
    pub capsule_type: CapsuleType, // 캡슐 종류
    pub unlock_at: Option<i64>,    // (선택) 타임락 해제 시간
    pub location: Option<String>,  // (선택) 위치 정보
}

impl CapsuleMetadata {
    pub const LEN: usize = 8             // discriminator
        + 32                             // author (Pubkey)
        + 4 + 64                         // title (String + len)
        + 4 + 64                         // recipient (String + len)
        + 4 + 256                        // message (String + len)
        + 4 + 256                        // media_url (String + len)
        + 8                              // created_at (i64)
        + 1                              // capsule_type (Enum, 1바이트)
        + 1 + 8                          // unlock_at (Option<i64>, 1바이트 for Some/None + 8바이트 for i64)
        + 1 + 4 + 64;                    // location (Option<String>, 1바이트 for Some/None + 4바이트 for len + 64바이트 for String)
}

#[error_code]
pub enum CustomError {
    #[msg("Mint authority mismatch.")]
    InvalidMintAuthority,
    #[msg("Capsule is locked and cannot be opened yet")]
    CapsuleLocked,
    #[msg("Capsule is location-locked and your current location does not match.")]
    LocationMismatch,
    #[msg("Title exceeds maximum allowed length.")]
    TitleTooLong,
    #[msg("Message exceeds maximum allowed length.")]
    MessageTooLong,
    #[msg("Media URL exceeds maximum allowed length.")]
    MediaUrlTooLong,
    #[msg("Recipient name exceeds maximum allowed length.")]
    RecipientTooLong,
    #[msg("Location string exceeds maximum allowed length.")]
    LocationTooLong,
}