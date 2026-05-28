"use client";

import { usePrivy } from "@privy-io/react-auth";
import { AtSign, Check, Copy, Share2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  buildProfileShareUrl,
  makeProfileCodePattern,
} from "@/lib/users/profile-code";
import {
  ACCENT,
  BG,
  DIM,
  FAINT,
  FG,
  GREEN,
  PANEL,
  PANEL_2,
  Stamp,
} from "@/components/v2/ui";

interface PublicUserProfile {
  displayName: string;
  handle: string;
  avatarSeed: string;
}

interface UserMeResponse {
  user: {
    id: string;
    privyId: string;
    solanaPubkey: string | null;
    profile: PublicUserProfile;
  };
}

export function ProfileShareCard({
  walletAddress,
}: {
  walletAddress: string | null;
}) {
  const { authenticated, getAccessToken } = usePrivy();
  const [profile, setProfile] = useState<PublicUserProfile | null>(null);
  const [handleInput, setHandleInput] = useState("");
  const [origin, setOrigin] = useState("");
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeHandle =
    profile?.handle ?? walletFallbackHandle(walletAddress) ?? "gwk_anon";
  const shareUrl = origin
    ? buildProfileShareUrl(origin, activeHandle)
    : `/u/${activeHandle.replace(/^@+/, "")}`;
  const codePattern = useMemo(
    () => makeProfileCodePattern(`${activeHandle}:${shareUrl}`),
    [activeHandle, shareUrl],
  );

  const loadProfile = useCallback(async () => {
    if (!authenticated) return;
    const token = await getAccessToken();
    if (!token) return;

    const response = await fetch("/api/users/me", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ solanaPubkey: walletAddress }),
    });
    if (!response.ok) throw new Error(`profile ${response.status}`);
    const data = (await response.json()) as UserMeResponse;
    setProfile(data.user.profile);
    setHandleInput(data.user.profile.handle);
  }, [authenticated, getAccessToken, walletAddress]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadProfile();
      } catch (err) {
        if (!cancelled) {
          console.error("[profile-share] load", err);
          setError("Profile unavailable.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProfile]);

  const saveHandle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not signed in");
      const response = await fetch("/api/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          handle: handleInput,
          solanaPubkey: walletAddress,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : `profile ${response.status}`,
        );
      }
      const next = data as UserMeResponse;
      setProfile(next.user.profile);
      setHandleInput(next.user.profile.handle);
      setStatus("HANDLE SAVED");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const shareProfile = async () => {
    if (sharing) return;
    setSharing(true);
    setStatus(null);
    setError(null);
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({
          title: `@${activeHandle}`,
          text: `@${activeHandle}`,
          url: shareUrl,
        });
        setStatus("SHARED");
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setStatus("LINK COPIED");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSharing(false);
    }
  };

  const copyProfile = async () => {
    setStatus(null);
    setError(null);
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus("LINK COPIED");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="mt-5">
      <Stamp label="CUSTOM CODE" />
      <div
        className="mt-2 p-4"
        style={{
          background: PANEL,
          border: `1px solid ${FAINT}`,
          borderRadius: 18,
        }}
      >
        <div className="flex items-start gap-4">
          <div
            className="grid shrink-0 gap-[2px] rounded-xl p-2"
            style={{
              gridTemplateColumns: "repeat(15, minmax(0, 1fr))",
              width: 118,
              height: 118,
              background: FG,
              border: `1px solid ${FAINT}`,
            }}
            aria-label={`Share code for @${activeHandle}`}
          >
            {codePattern.flatMap((row, y) =>
              row.map((on, x) => (
                <span
                  key={`${x}:${y}`}
                  className="rounded-[1px]"
                  style={{ background: on ? BG : FG }}
                />
              )),
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div
              className="truncate text-[22px] font-black leading-none"
              style={{ color: FG }}
            >
              @{activeHandle}
            </div>
            <div
              className="mt-2 truncate text-[10px] font-black uppercase tracking-widest"
              style={{ color: DIM }}
            >
              {shareUrl}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={shareProfile}
                disabled={sharing}
                className="flex min-h-10 items-center justify-center gap-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:opacity-40"
                style={{ background: ACCENT, color: BG }}
              >
                <Share2 size={14} strokeWidth={3} />
                SHARE
              </button>
              <button
                type="button"
                onClick={copyProfile}
                className="flex min-h-10 items-center justify-center gap-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition active:scale-[0.97]"
                style={{
                  background: PANEL_2,
                  color: FG,
                  border: `1px solid ${FAINT}`,
                }}
              >
                {status === "LINK COPIED" ? (
                  <Check size={14} strokeWidth={3} />
                ) : (
                  <Copy size={14} strokeWidth={3} />
                )}
                COPY
              </button>
            </div>
          </div>
        </div>

        <form onSubmit={saveHandle} className="mt-4 flex gap-2">
          <label
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3"
            style={{
              background: BG,
              color: FG,
              border: `1px solid ${FAINT}`,
            }}
          >
            <AtSign size={14} strokeWidth={3} style={{ color: DIM }} />
            <input
              value={handleInput}
              onChange={(event) => setHandleInput(event.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="min-h-12 min-w-0 flex-1 bg-transparent text-[13px] font-black lowercase tracking-widest outline-none placeholder:text-neutral-600"
              placeholder="handle"
            />
          </label>
          <button
            type="submit"
            disabled={saving || handleInput.trim().length === 0}
            className="min-h-12 rounded-xl px-4 text-[10px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:opacity-40"
            style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }}
          >
            {saving ? "SAVING" : "SAVE @"}
          </button>
        </form>

        {status ? (
          <p
            className="mt-3 text-[10px] font-black uppercase tracking-widest"
            style={{ color: GREEN }}
          >
            {status}
          </p>
        ) : null}
        {error ? (
          <p
            className="mt-3 text-[10px] font-black uppercase tracking-widest leading-relaxed"
            style={{ color: "#fb7185" }}
          >
            {error.slice(0, 140)}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function walletFallbackHandle(walletAddress: string | null): string | null {
  if (!walletAddress) return null;
  return `gwk_${walletAddress.slice(0, 4)}`;
}
