const BIGINT_BUFFER_FALLBACK_WARNING =
  "bigint: Failed to load bindings, pure JS will be used";

let installed = false;

export function suppressKnownRuntimeWarnings(): void {
  if (installed) return;
  installed = true;

  const originalWarn = console.warn.bind(console);

  console.warn = (...args: Parameters<typeof console.warn>) => {
    const [first] = args;
    if (
      typeof first === "string" &&
      first.startsWith(BIGINT_BUFFER_FALLBACK_WARNING)
    ) {
      return;
    }

    originalWarn(...args);
  };
}
