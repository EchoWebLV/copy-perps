/**
 * Hyperliquid addresses tracked for the whale feed.
 *
 * The refresh pipeline now discovers whales DYNAMICALLY from Hyperliquid's
 * public leaderboard each tick (see lib/hyperliquid/leaderboard.ts +
 * refresh-hyperliquid.ts), applying the same filters that originally seeded
 * this list: directional traders with positive 7d PnL, account value
 * $250k–$50M, and a sane volume-to-account ratio so HFT/MM bots are excluded.
 *
 * CURATED_WHALES below is no longer the primary source — it is the FALLBACK
 * roster used when the leaderboard fetch is unavailable (rate-limited, down),
 * so the feed never goes dark. It is also still polled directly by the
 * liquidation / whale-open buffers in client.ts. Empty / inactive addresses
 * are tolerated — they just contribute zero cards.
 */
export interface CuratedWhale {
  address: string;
  label?: string;
}

/**
 * Hand-picked Hyperliquid whales that are ALWAYS surfaced, on top of whatever
 * dynamic leaderboard discovery turns up that tick. Mirrors Pacifica's
 * CURATED_PACIFICA_WHALES pin slot. Start empty — add addresses here to force
 * a specific trader into the feed regardless of their current leaderboard rank.
 */
export const PINNED_HYPERLIQUID_WHALES: CuratedWhale[] = [];

export const CURATED_WHALES: CuratedWhale[] = [
  { address: "0xa5b0edf6b55128e0ddae8e51ac538c3188401d41" },
  { address: "0x6c8512516ce5669d35113a11ca8b8de322fd84f6" },
  { address: "0x5b5d51203a0f9079f8aeb098a6523a13f298c060" },
  { address: "0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36" },
  { address: "0xa1830e8d9f019feb448478a171bb37cc6c4c0482" },
  { address: "0x939f95036d2e7b6d7419ec072bf9d967352204d2" },
  { address: "0xe867fbdad3291530e41530301ecb77693850c78e" },
  { address: "0xbdfa4f4492dd7b7cf211209c4791af8d52bf5c50" },
  { address: "0x03b9a189e2480d1e4c3007080b29f362282130fa" },
  { address: "0x023a3d058020fb76cca98f01b3c48c8938a22355" },
  { address: "0x66f463866512fc337c89bad2032acbe38ee38836" },
  { address: "0x8ea85cbd59affca28162fc286d5c093dd0f8edbc" },
  { address: "0x519c721de735f7c9e6146d167852e60d60496a47" },
  { address: "0xa65ce1d604fa901c13aa29f2126a57d9032e412b" },
  { address: "0x469e9a7f624b04c24f0e64edf8d8a277e6bf58a5" },
  { address: "0x92b75a5bfb7be7911747276ad335b8f5da3ce0f4" },
  { address: "0xac03fc4c21902e4e934b4367cb1a6c6e3f0d8037" },
  { address: "0xfd423284f6a9c73a2a3d53cab8921d6533533d97" },
  { address: "0xa31441e058492bc7cfffda9aa7623c407ae83a81" },
  { address: "0x1e48f1007fa133f643941d58cb6b080dc621e773" },
  { address: "0xe2823659be02e0f48a4660e4da008b5e1abfdf29" },
  { address: "0xa875890465da20062bcf3b024bf7d54e69c725a8" },
  { address: "0xaefcc9cacbe0e41978bef1818358f471848de9cb" },
  { address: "0xb581d667c53fd8a50bf7ffd817be0e62daa16f4f" },
  { address: "0x66466428990e0f42a4c54f64bee0db6bf2336de5" },
  { address: "0x9c89f595f5515609ad61f6fda94beff85ae6600e" },
  { address: "0x6666885961fec8ed58ddb45637ea41c02d6423f5" },
  { address: "0x8def9f50456c6c4e37fa5d3d57f108ed23992dae" },
  { address: "0xebe837cd345469cbc5d6e1fd3d15ee5079ac885f" },
  { address: "0x5d2f4460ac3514ada79f5d9838916e508ab39bb7" },
  { address: "0xfa0f450d61acd11bc0f6a986260fc25c1758ccb9" },
  { address: "0xa445a0a15b1d50fa0c4bfe6796d9447e0da5329d" },
  { address: "0xbcd420d13362532756c968f663f96ba95e240dd2" },
  { address: "0x015354106478dda69c4aae3c0cf801290b738052" },
  { address: "0xc179e03922afe8fa9533d3f896338b9fb87ce0c8" },
  { address: "0xa0d66bab5f04cb3055cc2f6b0494cb33be32c2c2" },
  { address: "0x8607a7d180de23645db594d90621d837749408d5" },
  { address: "0xb8ebd6ed57f4102be5b1caf60d01dd1c9f270f94" },
  { address: "0x795cfd1b03eafc11c4ec958b8a94cfc9aa64a242" },
  { address: "0x8af700ba841f30e0a3fcb0ee4c4a9d223e1efa05" },
  { address: "0x7dacca323e44f168494c779bb5e7483c468ef410" },
  { address: "0x2312b5480f7e3d1894ed046af15b23186ff0f53c" },
  { address: "0x2d99fe0f36c1aebd28a1a2c0e82e8ca13c2ea351" },
  { address: "0xf28e1b06e00e8774c612e31ab3ac35d5a720085f" },
  { address: "0xd8d5b0f7219aed171efb5ae2ac3b9941206f7349" },
  { address: "0xa9b95f2a2e7ef219021efc5c04c32761b8553bbd" },
  { address: "0x2fd6e64bdce13f79dba8e430cd5a2bfea813f1c9" },
  { address: "0x4f9b096385c4e66ce3dec9a17e150795b9a02e3f" },
  { address: "0x23afa6c8b67f9dda2751254e8be260ccb950e2c0" },
  { address: "0xa906355beaf1d69a5fe73ce55899c49c6e67916c" },
  { address: "0x3d4648e9dc896e86e92ebdb98a80cc294069b96d" },
  { address: "0x152e41f0b83e6cad4b5dc730c1d6279b7d67c9dc" },
  { address: "0xa3d843b6a057504284006bef6f34a2e9bc80fb6b" },
  { address: "0x5f94a51948d2376ad34a6fadfa2544e651b74b96" },
  { address: "0x577ae91c7b74f04ddb3a5b399ded8318e9895fd2" },
];

export function truncateEthAddress(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
