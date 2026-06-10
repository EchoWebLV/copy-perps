import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "components/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    // Dummy URL so importing @/lib/db (which builds a postgres.js pool at
    // module load) never throws in tests. postgres.js connects lazily, and
    // every test that actually queries mocks @/lib/db — so no real
    // connection is ever attempted against this.
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
