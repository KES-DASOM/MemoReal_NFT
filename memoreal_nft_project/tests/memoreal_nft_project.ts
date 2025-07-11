import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MemorealNftProject } from "../target/types/memoreal_nft_project";
import { getAssociatedTokenAddressSync, createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token"; // SPL 토큰 관련 함수 임포트
import { BN } from "bn.js"; // Anchor.BN 대신 직접 BN 임포트 (타입스크립트 호환성)

describe("memoreal_nft_project", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.memorealNftProject as Program<MemorealNftProject>;
  const provider = anchor.getProvider();
  const wallet = provider.wallet;

  // 새로 생성할 NFT 민트 계정 및 토큰 계정 키페어 선언
  let mintAccount: anchor.web3.PublicKey;
  let tokenAccount: anchor.web3.PublicKey;
  let mintAuthority: anchor.web3.Keypair; // 민트 권한을 가진 키페어

  // 모든 테스트 전에 실행될 초기화 블록
  before(async () => {
    // 1. NFT 민트 권한으로 사용할 새로운 키페어 생성
    mintAuthority = anchor.web3.Keypair.generate();

    // 2. 민트 계정 생성 (decimals: 0으로 NFT임을 나타냄)
    // 이 계정이 NFT의 "클래스"를 나타냅니다.
    mintAccount = await createMint(
      provider.connection,
      wallet.payer, // 트랜잭션을 서명하고 비용을 지불할 지갑 (현재 provider의 지갑 사용)
      mintAuthority.publicKey, // 민트 권한
      null, // 동결 권한 (없음)
      0 // decimals: NFT는 0이여야 합니다. (분할 불가능)
    );
    console.log("새로운 NFT 민트 계정 생성:", mintAccount.toBase58());

    tokenAccount = await getAssociatedTokenAddressSync(
      mintAccount, // 민트 계정의 공개 키
      wallet.publicKey // NFT를 받을 지갑의 공개 키 (현재 provider의 지갑 사용)
    );

    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer, // 트랜잭션을 서명하고 비용을 지불할 지갑
      mintAccount, // 민트 계정
      wallet.publicKey // NFT를 받을 지갑
    );
    console.log("NFT를 받을 토큰 계정:", tokenAccount.toBase58());
  });


  it("Creates a capsule!", async () => {
    const capsule = anchor.web3.Keypair.generate();

    const tx = await program.methods
      .createCapsule(
        "졸업기념",                     // title
        "윤도훈",                       // recipient
        "우리 우정 영원하자",           // message
        "ipfs://example",             // media_url
        { timeLocked: {} },             // capsule_type (enum)
        new BN(Math.floor(Date.now() / 1000) + 60), // unlock_at (현재 시간 + 60초)
        "서울특별시 구로구"              // location
      )
      .accounts({
        capsule: capsule.publicKey,
        author: wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([capsule])
      .rpc();

    console.log("✅ 캡슐 생성 성공! Tx:", tx);
  });

  it("Mints an NFT!", async () => {
    const tx = await program.methods
      .mintNft()
      .accounts({
        mint: mintAccount, // before 훅에서 생성한 민트 계정
        tokenAccount: tokenAccount, // before 훅에서 생성/가져온 토큰 계정
        author: mintAuthority.publicKey, // 민트 권한을 가진 키페어의 공개 키
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, // SPL Token Program ID
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([mintAuthority]) // 민트 권한이 있는 키페어로 트랜잭션 서명
      .rpc();

    console.log("✅ NFT 발행 성공! Tx:", tx);

    // NFT가 성공적으로 발행되었는지 확인 (선택 사항)
    const tokenAccountInfo = await provider.connection.getTokenAccountBalance(tokenAccount);
    console.log("토큰 계정의 NFT 잔액:", tokenAccountInfo.value.uiAmount);
    // expect(tokenAccountInfo.value.uiAmount).to.equal(1); // chai/mocha를 사용한다면
  });

  // 추가: 잠금 해제 가능 여부 테스트
  it("Checks if capsule is unlockable", async () => {

    const tempCapsuleKey = anchor.web3.Keypair.generate().publicKey; // 임시 더미 키


    const allCapsules = await program.account.capsuleMetadata.all();
    let capsuleForUnlockCheck: anchor.web3.PublicKey;

    if (allCapsules.length > 0) {
      capsuleForUnlockCheck = allCapsules[0].publicKey; // 첫 번째 캡슐 사용
    } else {
      console.warn("테스트할 캡슐을 찾을 수 없습니다. 새로운 캡슐을 만듭니다.");
      const newCapsule = anchor.web3.Keypair.generate();
      await program.methods
        .createCapsule(
          "테스트 캡슐",
          "테스터",
          "테스트 메시지",
          "ipfs://test",
          { general: {} }, // 일반 캡슐로 생성
          null,
          null
        )
        .accounts({
          capsule: newCapsule.publicKey,
          author: wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([newCapsule])
        .rpc();
      capsuleForUnlockCheck = newCapsule.publicKey;
      console.log("새 테스트 캡슐 생성:", capsuleForUnlockCheck.toBase58());
    }


    const isUnlockable = await program.methods
      .isUnlockable()
      .accounts({
        capsule: capsuleForUnlockCheck, // 조회할 캡슐 계정
      })
      .view(); // `view()`는 체인 상태를 변경하지 않고 값을 읽을 때 사용 (솔라나 simulate 트랜잭션)

    console.log("캡슐 잠금 해제 가능 여부:", isUnlockable);
    // expect(isUnlockable).to.be.true; // 또는 false, 테스트 시나리오에 따라
  });
});