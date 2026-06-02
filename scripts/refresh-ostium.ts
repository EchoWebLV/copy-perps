import { refreshOstiumWhales } from "@/lib/whales/refresh-ostium";

async function main() {
  console.log("[refresh:ostium] starting…");
  const start = Date.now();
  const result = await refreshOstiumWhales();
  console.log(`[refresh:ostium] done in ${Date.now() - start}ms`, result);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[refresh:ostium] failed:", err);
    process.exit(1);
  });
