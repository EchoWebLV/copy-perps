const BIGINT_BUFFER_FALLBACK_WARNING =
  "bigint: Failed to load bindings, pure JS will be used";

if (!globalThis.__copyPerpsKnownWarningFilterInstalled) {
  globalThis.__copyPerpsKnownWarningFilterInstalled = true;

  const originalWarn = console.warn.bind(console);
  console.warn = (...args) => {
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
