"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ConfigKnob } from "@/lib/bots/wiring";

export interface TemplateOption {
  id: string;
  name: string;
  avatarEmoji: string;
  strategyKey: string;
  family: string | null;
  familyDisplayName: string | null;
  config: Record<string, unknown>;
  startingBalanceUsd: number;
  knobs: ConfigKnob[];
}

interface Props {
  templates: TemplateOption[];
  initialParentId?: string | null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function CloneBotForm({ templates, initialParentId }: Props) {
  const router = useRouter();

  const initial =
    templates.find((t) => t.id === initialParentId) ?? templates[0];

  const [parentId, setParentId] = useState<string>(initial?.id ?? "");
  const [name, setName] = useState<string>(
    initial ? `${initial.name} Clone` : "",
  );
  const [emoji, setEmoji] = useState<string>(initial?.avatarEmoji ?? "🤖");
  const [startingBalanceUsd, setStartingBalanceUsd] = useState<number>(
    initial?.startingBalanceUsd ?? 1000,
  );

  const parent = useMemo(
    () => templates.find((t) => t.id === parentId) ?? initial,
    [templates, parentId, initial],
  );

  const [knobValues, setKnobValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const k of initial?.knobs ?? []) {
      const v = initial.config[k.key];
      out[k.key] = v === undefined || v === null ? "" : String(v);
    }
    return out;
  });

  // When the user changes parent, repopulate the defaults to that parent's
  // config values.
  useEffect(() => {
    if (!parent) return;
    const out: Record<string, string> = {};
    for (const k of parent.knobs) {
      const v = parent.config[k.key];
      out[k.key] = v === undefined || v === null ? "" : String(v);
    }
    setKnobValues(out);
    setEmoji(parent.avatarEmoji);
    setName((cur) => (cur ? cur : `${parent.name} Clone`));
    setStartingBalanceUsd(parent.startingBalanceUsd);
  }, [parentId, parent]);

  const newId = name ? slugify(name) : "";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function coerce(value: string, type: ConfigKnob["type"]): unknown {
    if (type === "string") return value;
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error("invalid number");
    return n;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!parent) return;
    setError(null);
    setSaving(true);
    try {
      const config: Record<string, unknown> = {};
      for (const k of parent.knobs) {
        const raw = knobValues[k.key];
        if (raw === "") continue;
        try {
          config[k.key] = coerce(raw, k.type);
        } catch {
          throw new Error(`Invalid value for "${k.key}" (expected ${k.type})`);
        }
      }

      const res = await fetch(`/api/admin/bots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parentId: parent.id,
          name,
          avatarEmoji: emoji,
          // We carry the parent's strategyKey *family* through here. The
          // new bot gets its own strategyKey = slug, which the resolver
          // resolves via family-prefix in lib/bots/wiring.
          family: parent.family,
          config,
          startingBalanceUsd,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`${res.status}: ${txt}`);
      }
      const json = (await res.json()) as { ok: boolean; id: string };
      router.push(`/admin/bots/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clone failed");
      setSaving(false);
    }
  }

  if (!parent) {
    return (
      <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-4 text-sm text-amber-300">
        No templates available — seed the DB first.
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Section
        title="1. Parent template"
        subtitle="The new bot inherits this bot's strategy family (logic) and config defaults. Variants of the same family share the factory but use their own knob values."
      >
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className={inputCls}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.avatarEmoji} {t.name} ({t.familyDisplayName ?? t.strategyKey})
            </option>
          ))}
        </select>
      </Section>

      <Section title="2. Identity">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              required
            />
          </Field>
          <Field
            label="New bot id (auto from name)"
            hint="Lowercase slug. Must be unique across all bots."
          >
            <input value={newId} readOnly className={`${inputCls} opacity-60`} />
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
          <Field label="Starting balance ($)">
            <input
              type="number"
              step="1"
              value={startingBalanceUsd}
              onChange={(e) => setStartingBalanceUsd(Number(e.target.value))}
              className={inputCls}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="3. Strategy config"
        subtitle={`These knobs feed the ${parent.familyDisplayName ?? parent.family ?? "unknown"} factory. Tune them to differentiate this variant.`}
      >
        {parent.knobs.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No known config knobs for this family.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {parent.knobs.map((k) => (
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
      </Section>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || !name}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create variant"}
        </button>
        <span className="text-xs text-zinc-500">
          Inserts a new row and registers the strategy in the runtime registry;
          the resolver picks it up on the next tick.
        </span>
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
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
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
        {subtitle && <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
