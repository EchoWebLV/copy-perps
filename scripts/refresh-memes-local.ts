import { refreshMemes } from "../lib/signals/refresh-memes";

(async () => {
  console.log("Refreshing memes…");
  const start = Date.now();
  try {
    const result = await refreshMemes();
    console.log(`Done in ${Date.now() - start}ms:`, result);
  } catch (err) {
    console.error("Failed:", err);
    process.exit(1);
  }
  process.exit(0);
})();
