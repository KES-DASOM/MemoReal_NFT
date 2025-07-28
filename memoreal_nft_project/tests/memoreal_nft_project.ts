import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MemorealNftProject } from "../target/types/memoreal_nft_project";
import { 
  Keypair, 
  PublicKey, 
  SystemProgram, 
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY 
} from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  getAssociatedTokenAddress
} from "@solana/spl-token";
import { expect } from "chai";

// Metaplex 관련
const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

describe("memoreal-nft-project", () => {
  before(function() {
    this.timeout(30000); // 테스트 실행 시간 제한 설정
  });
  // Provider 설정
      const connection = new anchor.web3.Connection("http://127.0.0.1:8899", "confirmed");
  const keypair = anchor.web3.Keypair.generate();
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, anchor.AnchorProvider.defaultOptions());
  anchor.setProvider(provider);

  const program = anchor.workspace.MemorealNftProject;

  before(async () => {
    if (!program){
      throw new Error("Program not found. Make sure to run 'anchor build' first.");
    }
    console.log("프로그램 ID:", program.programId.toString());
  });

  // 테스트용 키페어들
  let author: Keypair;
  let capsuleAccount: Keypair;
  let mintKeypair: Keypair;
  let tokenAccount: PublicKey;
  let metadataAccount: PublicKey;

  beforeEach(async () => {
    // 새로운 키페어 생성
    author = Keypair.generate();
    capsuleAccount = Keypair.generate();
    mintKeypair = Keypair.generate();

    // 작성자에게 SOL 에어드랍
    const signature = await provider.connection.requestAirdrop(
      author.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature, 'confirmed');

    // 민트 계정 생성
    await createMint(
      provider.connection,
      author,
      author.publicKey, // mint authority
      null, // freeze authority
      0, // decimals (NFT는 0)
      mintKeypair
    );

    // 토큰 계정 생성
    tokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      author,
      mintKeypair.publicKey,
      author.publicKey
    );

    // 메타데이터 계정 주소 계산
    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        METAPLEX_PROGRAM_ID.toBuffer(),
        mintKeypair.publicKey.toBuffer(),
      ],
      METAPLEX_PROGRAM_ID
    );
    metadataAccount = metadataPDA;
  });

  describe("캡슐 생성 테스트", () => {
    it("일반 캡슐 생성 성공", async () => {
      const title = "첫 번째 메모리얼";
      const recipient = "사랑하는 가족";
      const message = "이 메시지는 나중에 볼 수 있도록 저장됩니다.";
      const mediaUrl = "https://ipfs.io/ipfs/QmExample123";

      const tx = await program.methods
        .createCapsule(
          title,
          recipient,
          message,
          mediaUrl,
          { general: {} }, // CapsuleType::General
          null, // unlock_at
          null  // location
        )
        .accounts({
          capsule: capsuleAccount.publicKey,
          author: author.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([author, capsuleAccount])
        .rpc();

      console.log("캡슐 생성 트랜잭션:", tx);

      // 생성된 캡슐 데이터 확인
      const capsuleData = await program.account.capsuleMetadata.fetch(
        capsuleAccount.publicKey
      );

      expect(capsuleData.title).to.equal(title);
      expect(capsuleData.recipient).to.equal(recipient);
      expect(capsuleData.message).to.equal(message);
      expect(capsuleData.mediaUrl).to.equal(mediaUrl);
      expect(capsuleData.author.toString()).to.equal(author.publicKey.toString());
    });

    it("타임 락 캡슐 생성 성공", async () => {
      const title = "미래의 메시지";
      const recipient = "미래의 나";
      const message = "1년 후에 읽을 메시지입니다.";
      const mediaUrl = "https://ipfs.io/ipfs/QmFuture456";
      const unlockAt = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60); // 1년 후
      const location = "서울시 강남구";

      const capsuleAccount2 = Keypair.generate();

      const tx = await program.methods
        .createCapsule(
          title,
          recipient,
          message,
          mediaUrl,
          { timeLocked: {} }, // CapsuleType::TimeLocked
          new anchor.BN(unlockAt),
          location
        )
        .accounts({
          capsule: capsuleAccount2.publicKey,
          author: author.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([author, capsuleAccount2])
        .rpc();

      console.log("타임 락 캡슐 생성 트랜잭션:", tx);

      const capsuleData = await program.account.capsuleMetadata.fetch(
        capsuleAccount2.publicKey
      );

      expect(capsuleData.title).to.equal(title);
      expect(capsuleData.unlockAt.toNumber()).to.equal(unlockAt);
      expect(capsuleData.location).to.equal(location);
    });

    it("너무 긴 제목으로 캡슐 생성 실패", async () => {
      const longTitle = "a".repeat(65); // 64자 제한 초과

      try {
        await program.methods
          .createCapsule(
            longTitle,
            "수신자",
            "메시지",
            "https://example.com",
            { general: {} },
            null,
            null
          )
          .accounts({
            capsule: capsuleAccount.publicKey,
            author: author.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([author, capsuleAccount])
          .rpc();

        expect.fail("에러가 발생해야 합니다.");
      } catch (error) {
        const errorMessage = error?.error?.errorMessage || error?.message || error.toString();
        expect(errorMessage).to.include("Title exceeds maximum allowed length");
      }
    });
  });

  describe("NFT 민팅 테스트", () => {
    beforeEach(async () => {
      // 테스트를 위한 일반 캡슐 먼저 생성
      await program.methods
        .createCapsule(
          "NFT용 캡슐",
          "수신자",
          "NFT로 만들 메시지",
          "https://ipfs.io/ipfs/QmNFT789",
          { general: {} },
          null,
          null
        )
        .accounts({
          capsule: capsuleAccount.publicKey,
          author: author.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([author, capsuleAccount])
        .rpc();
    });

    it("NFT 민팅 성공", async () => {
      const nftName = "Memoreal NFT #1";
      const nftSymbol = "MEM";
      const nftUri = "https://ipfs.io/ipfs/QmNFTMetadata123";

      // 메타데이터 계정에 대한 rent 확인
  const rentExemption = await provider.connection.getMinimumBalanceForRentExemption(679);

      const tx = await program.methods
        .mintNft(nftName, nftSymbol, nftUri)
        .accounts({
          mint: mintKeypair.publicKey,
          tokenAccount: tokenAccount,
          author: author.publicKey,
          metadataAccount: metadataAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          tokenMetadataProgram: METAPLEX_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([author])
        .rpc();

      console.log("NFT 민팅 트랜잭션:", tx);

      // 토큰 계정의 잔액 확인 (NFT이므로 1이어야 함)
      const tokenAccountInfo = await provider.connection.getTokenAccountBalance(tokenAccount);
      expect(tokenAccountInfo.value.amount).to.equal("1");
    });

    it("잘못된 민트 권한으로 NFT 민팅 실패", async () => {
      const wrongAuthority = Keypair.generate();
      
      // 잘못된 권한자에게 SOL 에어드랍
      const signature = await provider.connection.requestAirdrop(
        wrongAuthority.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(signature);

      try {
        await program.methods
          .mintNft("Test NFT", "TEST", "https://example.com")
          .accounts({
            mint: mintKeypair.publicKey,
            tokenAccount: tokenAccount,
            author: wrongAuthority.publicKey, // 잘못된 권한자
            metadataAccount: metadataAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            tokenMetadataProgram: METAPLEX_PROGRAM_ID,
            sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .signers([wrongAuthority])
          .rpc();

        expect.fail("에러가 발생해야 합니다.");
      } catch (error) {
        expect(error.error.errorMessage).to.include("Mint authority mismatch");
      }
    });
  });

  describe("캡슐 조회 및 잠금 해제 테스트", () => {
    let generalCapsule: Keypair;
    let timeLockCapsule: Keypair;

    beforeEach(async () => {
      generalCapsule = Keypair.generate();
      timeLockCapsule = Keypair.generate();

      // 일반 캡슐 생성
      await program.methods
        .createCapsule(
          "일반 캡슐",
          "수신자1",
          "언제든지 볼 수 있는 메시지",
          "https://ipfs.io/ipfs/QmGeneral",
          { general: {} },
          null,
          null
        )
        .accounts({
          capsule: generalCapsule.publicKey,
          author: author.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([author, generalCapsule])
        .rpc();

      // 미래 시간으로 설정된 타임 락 캡슐 생성
      const futureTime = Math.floor(Date.now() / 1000) + 3600; // 1시간 후
      await program.methods
        .createCapsule(
          "타임 락 캡슐",
          "수신자2",
          "나중에 볼 수 있는 메시지",
          "https://ipfs.io/ipfs/QmTimeLock",
          { timeLocked: {} },
          new anchor.BN(futureTime),
          "서울시 강남구"
        )
        .accounts({
          capsule: timeLockCapsule.publicKey,
          author: author.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([author, timeLockCapsule])
        .rpc();
    });

    it("일반 캡슐 조회 성공", async () => {
      const result = await program.methods
        .viewCapsule(null)
        .accounts({
          capsule: generalCapsule.publicKey,
        })
        .view();

      expect(result.title).to.equal("일반 캡슐");
      expect(result.message).to.equal("언제든지 볼 수 있는 메시지");
    });

    it("잠긴 타임 락 캡슐 조회 실패", async () => {
      try {
        await program.methods
          .viewCapsule("서울시 강남구")
          .accounts({
            capsule: timeLockCapsule.publicKey,
          })
          .view();

        expect.fail("에러가 발생해야 합니다.");
      } catch (error) {
        expect(error.error.errorMessage).to.include("Capsule is locked");
      }
    });

    it("일반 캡슐 잠금 해제 가능 확인", async () => {
      const result = await program.methods
        .isUnlockable()
        .accounts({
          capsule: generalCapsule.publicKey,
        })
        .view();

      expect(result).to.be.true;
    });

    it("타임 락 캡슐 잠금 해제 불가 확인", async () => {
      const result = await program.methods
        .isUnlockable()
        .accounts({
          capsule: timeLockCapsule.publicKey,
        })
        .view();

      expect(result).to.be.false;
    });

    it("과거 시간 타임 락 캡슐 조회 성공", async () => {
      // 과거 시간으로 설정된 캡슐 생성
      const pastCapsule = Keypair.generate();
      const pastTime = Math.floor(Date.now() / 1000) - 3600; // 1시간 전

      await program.methods
        .createCapsule(
          "과거 타임 락 캡슐",
          "수신자3",
          "이미 열 수 있는 메시지",
          "https://ipfs.io/ipfs/QmPast",
          { timeLocked: {} },
          new anchor.BN(pastTime),
          null
        )
        .accounts({
          capsule: pastCapsule.publicKey,
          author: author.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([author, pastCapsule])
        .rpc();

      // 조회 시도
      const result = await program.methods
        .viewCapsule(null)
        .accounts({
          capsule: pastCapsule.publicKey,
        })
        .view();

      expect(result.title).to.equal("과거 타임 락 캡슐");
      expect(result.message).to.equal("이미 열 수 있는 메시지");
    });
  });

  describe("에러 처리 테스트", () => {
    it("존재하지 않는 캡슐 조회 실패", async () => {
      const nonExistentCapsule = Keypair.generate();

      try {
        await program.methods
          .viewCapsule(null)
          .accounts({
            capsule: nonExistentCapsule.publicKey,
          })
          .view();

        expect.fail("에러가 발생해야 합니다.");
      } catch (error) {
        expect(error.message).to.include("Account does not exist");
      }
    });

    it("너무 긴 메시지로 캡슐 생성 실패", async () => {
      const longMessage = "a".repeat(257); // 256자 제한 초과
      const failCapsule = Keypair.generate();

      try {
        await program.methods
          .createCapsule(
            "제목",
            "수신자",
            longMessage,
            "https://example.com",
            { general: {} },
            null,
            null
          )
          .accounts({
            capsule: failCapsule.publicKey,
            author: author.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([author, failCapsule])
          .rpc();

        expect.fail("에러가 발생해야 합니다.");
      } catch (error) {
        expect(error.error.errorMessage).to.include("Message exceeds maximum allowed length");
      }
    });
  });
}); 