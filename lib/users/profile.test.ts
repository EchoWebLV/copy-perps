import { describe, expect, it } from "vitest";
import {
  buildDefaultUserProfileValues,
  buildPublicUserProfile,
} from "./profile";

describe("user profiles", () => {
  it("builds a public profile from wallet-backed user data", () => {
    const profile = buildPublicUserProfile({
      id: "138fdd9f-4de6-4592-b40d-6d70f512d111",
      privyId: "did:privy:test",
      solanaPubkey: "4Hx2k4mR9Wallet",
      displayName: null,
      handle: null,
      avatarSeed: null,
    });

    expect(profile).toEqual({
      displayName: "gwk_4Hx2",
      handle: "gwk_4Hx2",
      avatarSeed: "4Hx2k4mR9Wallet",
    });
  });

  it("prefers saved profile fields over generated fallbacks", () => {
    const profile = buildPublicUserProfile({
      id: "138fdd9f-4de6-4592-b40d-6d70f512d111",
      privyId: "did:privy:test",
      solanaPubkey: "4Hx2k4mR9Wallet",
      displayName: "Risk Surfer",
      handle: "risk_surfer",
      avatarSeed: "risk-surfer-seed",
    });

    expect(profile).toEqual({
      displayName: "Risk Surfer",
      handle: "risk_surfer",
      avatarSeed: "risk-surfer-seed",
    });
  });

  it("returns defaults that can be persisted when a user is created", () => {
    expect(
      buildDefaultUserProfileValues({
        id: "138fdd9f-4de6-4592-b40d-6d70f512d111",
        privyId: "did:privy:test",
        solanaPubkey: null,
      }),
    ).toEqual({
      displayName: "gwk_138f",
      handle: "gwk_138f",
      avatarSeed: "138fdd9f-4de6-4592-b40d-6d70f512d111",
    });
  });
});
