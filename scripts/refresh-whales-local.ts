import { refreshWhales } from "../lib/signals/refresh-whales";

(async () => {
  console.log("Refreshing whales…");
  const start = Date.now();
  try {
    const result = await refreshWhales();
    console.log(`Done in ${Date.now() - start}ms:`, result);
  } catch (err) {
    console.error("Failed:", err);
    process.exit(1);
  }
  process.exit(0);
})();
