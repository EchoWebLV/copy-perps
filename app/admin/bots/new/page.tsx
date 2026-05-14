import { db } from "@/lib/db";
import { bots } from "@/lib/db/schema";
import { getStrategyWiring } from "@/lib/bots/wiring";
import {
  CloneBotForm,
  type TemplateOption,
} from "@/components/admin/CloneBotForm";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ parent?: string }>;
}

async function loadTemplates(): Promise<TemplateOption[]> {
  const rows = await db.select().from(bots);
  return rows.map((r) => {
    const wiring = getStrategyWiring(r.strategyKey);
    return {
      id: r.id,
      name: r.name,
      avatarEmoji: r.avatarEmoji,
      strategyKey: r.strategyKey,
      family: wiring?.family ?? null,
      familyDisplayName: wiring?.displayName ?? null,
      config: (r.config as Record<string, unknown>) ?? {},
      startingBalanceUsd: r.startingBalanceUsd,
      knobs: wiring?.configKnobs ?? [],
    } satisfies TemplateOption;
  });
}

export default async function NewBotPage({ searchParams }: PageProps) {
  const { parent } = await searchParams;
  const templates = await loadTemplates();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Clone a variant
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Spin up a new bot row using an existing strategy family. The
          codebase already ships factories for{" "}
          {templates.filter((t) => t.family).length / 2} headliners — clones
          reuse the same logic but get their own config knobs, starting
          balance, and identity.
        </p>
      </div>
      <CloneBotForm templates={templates} initialParentId={parent ?? null} />
    </div>
  );
}
