const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type SearchableTrader = {
  id: string;
  kind: string;
  name: string;
  markets?: string[];
  desc?: string;
};

export function classifyQuery(q: string): "wallet" | "text" {
  return SOL_ADDR.test(q.trim()) ? "wallet" : "text";
}

export function filterTraders<T extends SearchableTrader>(list: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return list;
  return list.filter(
    (t) =>
      t.name.toLowerCase().includes(needle) ||
      (t.markets ?? []).some((m) => m.toLowerCase().includes(needle)) ||
      (t.desc ?? "").toLowerCase().includes(needle),
  );
}
