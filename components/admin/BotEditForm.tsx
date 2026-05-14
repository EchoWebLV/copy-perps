"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ConfigKnob } from "@/lib/bots/wiring";

export interface BotEditValues {
  id: string;
  name: string;
  avatarEmoji: string;
  status: string;
  personaVoiceKey: string;
  config: Record<string, unknown>;
  balanceUsd: number;
  startingBalanceUsd: number;
}

interface Props {
  initial: BotEditValues;
  knobs: ConfigKnob[];
}

const STATUS_OPTIONS = ["paper", "retired", "backtest-fail", "live", "busted"];

export function BotEditForm({ initial, knobs }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okFlash, setOkFlash] = useState(false);

  const [name, setName] = useState(initial.name);
  const [emoji, setEmoji] = useState(initial.avatarEmoji);
  const [status, setStatus] = useState(initial.status);
  const [voice, setVoice] = useState(initial.personaVoiceKey);
  const [balanceUsd, setBalanceUsd] = useState(initial.balanceUsd);
  const [startingBalanceUsd, setStartingBalanceUsd] = useState(
    initial.startingBalanceUsd,
  );

  // Build per-knob state, falling back to the bot's current config and then ""
  // for missing keys. Stored as strings so empty values are detectable; we
  // coerce per knob.type on submit.
  const [knobValues, setKnobValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const k of knobs) {
      const v = initial.config[k.key];
      out[k.key] = v === undefined || v === null ? "" : String(v);
    }
    return out;
  });

  // For bots whose strategyKey doesn't match a known family (cloned with a
  // typo, etc.) we also expose a JSON fallback for any keys not in `knobs`.
  const extraKeys = Object.keys(initial.config).filter(
    (k) => !knobs.some((kn) => kn.key === k),
  );
  const [extraJson, setExtraJson] = useState(() =>
    extraKeys.length
      ? JSON.stringify(
          Object.fromEntries(extraKeys.map((k) => [k, initial.config[k]])),
          null,
          2,
        )
      : "",
  );

  function coerce(value: string, type: ConfigKnob["type"]): unknown {
    if (type === "string") return value;
    if (type === "ms" || type === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error("invalid number");
      return n;
    }
    return value;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const config: Record<string, unknown> = {};
      for (const k of knobs) {
        const raw = knobValues[k.key];
        if (raw === "") continue;
        try {
          config[k.key] = coerce(raw, k.type);
        } catch {
          throw new Error(`Invalid value for "${k.key}" (expected ${k.type})`);
        }
      }
      if (extraJson.trim()) {
        try {
          const extras = JSON.parse(extraJson);
          if (extras && typeof extras === "object") {
            Object.assign(config, extras);
          }
        } catch {
          throw new Error("Extra-config JSON is malformed");
        }
      }

      const res = await fetch(`/api/admin/bots/${initial.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          avatarEmoji: emoji,
          status,
          personaVoiceKey: voice,
          config,
          balanceUsd,
          startingBalanceUsd,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Save failed: ${res.status} ${txt}`);
      }
      setOkFlash(true);
      router.refresh();
      setTimeout(() => setOkFlash(false), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onResetBalance() {
    if (!confirm(`Reset balance to $${startingBalanceUsd.toFixed(2)}?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/bots/${initial.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ balanceUsd: startingBalanceUsd }),
      });
      if (!res.ok) throw new Error(`Reset failed: ${res.status}`);
      setBalanceUsd(startingBalanceUsd);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            required
          />
        </Field>
        <Field label="Avatar emoji">
          <input
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            className={inputCls}
            maxLength={4}
            required
          />
        </Field>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={inputCls}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Persona voice key">
          <input
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <Section
        title="Bankroll"
        subtitle="Resolver sizes positions as balance × MAX_STAKE_PCT × conviction. Bots are marked busted when balance < $10."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Current balance ($)">
            <div className="flex gap-2">
              <input
                type="number"
                step="0.01"
                value={balanceUsd}
                onChange={(e) => setBalanceUsd(Number(e.target.value))}
                className={inputCls}
              />
              <button
                type="button"
                onClick={onResetBalance}
                className="rounded-lg border border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-800"
                title="Reset to starting balance"
              >
                ↻
              </button>
            </div>
          </Field>
          <Field label="Starting balance ($)">
            <input
              type="number"
              step="1"
              value={startingBalanceUsd}
              onChange={(e) =>
                setStartingBalanceUsd(Number(e.target.value))
              }
              className={inputCls}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Strategy config"
        subtitle="These knobs feed the strategy factory. Variants of the same family share the factory but use their own values here."
      >
        {knobs.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No known config knobs for this strategy family. Use the raw JSON
            box below.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {knobs.map((k) => (
              <Field
                key={k.key}
                label={k.key}
                hint={`${k.type} · ${k.purpose}`}
              >
                <input
                  value={knobValues[k.key] ?? ""}
                  onChange={(e) =>
                    setKnobValues((s) => ({ ...s, [k.key]: e.target.value }))
                  }
                  className={inputCls}
                />
              </Field>
            ))}
          </div>
        )}

        {extraKeys.length > 0 && (
          <details className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <summary className="cursor-pointer text-sm text-zinc-400">
              Extra config keys ({extraKeys.length})
            </summary>
            <textarea
              value={extraJson}
              onChange={(e) => setExtraJson(e.target.value)}
              rows={6}
              className={`${inputCls} mt-2 font-mono text-xs`}
            />
          </details>
        )}
      </Section>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {okFlash && (
          <span className="text-sm text-emerald-400">Saved.</span>
        )}
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-600 focus:outline-none";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-xs text-zinc-500">{hint}</span>
      )}
    </label>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          {title}
        </h3>
        {subtitle && (
          <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}
