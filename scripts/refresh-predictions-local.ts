import { refreshPredictions } from "../lib/signals/refresh-predictions";

(async () => {
  console.log("Refreshing predictions…");
  const start = Date.now();
  try {
    const result = await refreshPredictions();
    console.log(`Done in ${Date.now() - start}ms:`, result);
  } catch (err) {
    console.error("Failed:", err);
    process.exit(1);
  }
  process.exit(0);
})();
