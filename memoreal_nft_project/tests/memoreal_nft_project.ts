import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MemorealNftProject } from "../target/types/memoreal_nft_project";

describe("memoreal_nft_project", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.memorealNftProject as Program<MemorealNftProject>;
  const provider = anchor.getProvider();
  const wallet = provider.wallet;

  it("Creates a capsule!", async () => {
    const capsule = anchor.web3.Keypair.generate();

    const tx = await program.methods
      .createCapsule(
        "졸업기념",                        // title
        "윤도훈",                          // recipient
        "우리 우정 영원하자",             // message
        "ipfs://example",                 // media_url
        { timeLocked: {} },               // capsule_type (enum)
        new anchor.BN(Math.floor(Date.now() / 1000) + 60), // unlock_at
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
});
