import { refreshTraders } from "@/lib/signals/refresh-traders";

(async () => {
  console.log("Refreshing traders…");
  const start = Date.now();
  try {
    const result = await refreshTraders();
    console.log(`Done in ${Date.now() - start}ms:`, result);
  } catch (err) {
    console.error("Failed:", err);
    process.exit(1);
  }
  process.exit(0);
})();
