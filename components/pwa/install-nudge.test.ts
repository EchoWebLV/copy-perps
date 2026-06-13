import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shouldShowInstallNudge } from "./install-nudge-logic";

// ── shouldShowInstallNudge decision matrix ────────────────────────────────

describe("shouldShowInstallNudge", () => {
  it("returns null when already installed (standalone)", () => {
    expect(
      shouldShowInstallNudge({
        dismissed: false,
        standalone: true,
        isIOS: false,
        hasPrompt: true,
      }),
    ).toBeNull();
  });

  it("returns null when the user has dismissed the nudge", () => {
    expect(
      shouldShowInstallNudge({
        dismissed: true,
        standalone: false,
        isIOS: false,
        hasPrompt: true,
      }),
    ).toBeNull();
  });

  it("returns null when dismissed AND already standalone", () => {
    expect(
      shouldShowInstallNudge({
        dismissed: true,
        standalone: true,
        isIOS: true,
        hasPrompt: false,
      }),
    ).toBeNull();
  });

  it("returns 'android' when beforeinstallprompt is stashed and not installed", () => {
    expect(
      shouldShowInstallNudge({
        dismissed: false,
        standalone: false,
        isIOS: false,
        hasPrompt: true,
      }),
    ).toBe("android");
  });

  it("returns 'ios' on iOS Safari (no prompt, not installed, not dismissed)", () => {
    expect(
      shouldShowInstallNudge({
        dismissed: false,
        standalone: false,
        isIOS: true,
        hasPrompt: false,
      }),
    ).toBe("ios");
  });

  it("returns null when no prompt and not iOS (e.g. desktop browser)", () => {
    expect(
      shouldShowInstallNudge({
        dismissed: false,
        standalone: false,
        isIOS: false,
        hasPrompt: false,
      }),
    ).toBeNull();
  });

  it("prefers 'android' (native prompt) over 'ios' when both flags are set", () => {
    // Unusual but e.g. a future hybrid that fires beforeinstallprompt on iOS
    expect(
      shouldShowInstallNudge({
        dismissed: false,
        standalone: false,
        isIOS: true,
        hasPrompt: true,
      }),
    ).toBe("android");
  });
});

// ── manifest.json contract ────────────────────────────────────────────────

describe("manifest.json", () => {
  const manifestPath = join(process.cwd(), "public/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
    string,
    unknown
  >;

  it("is valid JSON with the stable app identity field", () => {
    expect(manifest.id).toBe("/feed");
  });

  it("keeps start_url pointing at /feed", () => {
    expect(manifest.start_url).toBe("/feed");
  });

  it("declares finance category", () => {
    expect(manifest.categories).toEqual(["finance"]);
  });

  it("has two shortcuts with correct urls", () => {
    const shortcuts = manifest.shortcuts as Array<{
      name: string;
      short_name: string;
      url: string;
    }>;
    expect(shortcuts).toHaveLength(2);

    const [live, copies] = shortcuts;
    expect(live).toMatchObject({ name: "Live", short_name: "Live", url: "/chatter" });
    expect(copies).toMatchObject({ name: "My copies", short_name: "Copies", url: "/portfolio" });
  });

  it("shortcut icons array is absent (screenshot files not yet published)", () => {
    const shortcuts = manifest.shortcuts as Array<{ icons?: unknown }>;
    for (const s of shortcuts) {
      expect(s.icons).toBeUndefined();
    }
  });

  it("retains all original fields without modification", () => {
    expect(manifest.name).toBe("gwak.gg");
    expect(manifest.short_name).toBe("gwak");
    expect(manifest.description).toBe("Watch the whales. Tail the signal.");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBe("#0a0a0a");
    expect(manifest.theme_color).toBe("#0a0a0a");
    expect(manifest.orientation).toBe("portrait");
    expect(Array.isArray(manifest.icons)).toBe(true);
  });

  it("does NOT include a screenshots array (deferred to prod capture)", () => {
    expect(manifest.screenshots).toBeUndefined();
  });
});
