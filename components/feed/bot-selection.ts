type SelectableBot = {
  payload: {
    botId: string;
    currentPositions: unknown[];
  };
};

export function pickInitialBotId<T extends SelectableBot>(
  bots: T[],
): string | null {
  const active = bots.find((bot) => bot.payload.currentPositions.length > 0);
  return active?.payload.botId ?? bots[0]?.payload.botId ?? null;
}
