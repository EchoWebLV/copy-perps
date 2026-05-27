import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

const root = process.cwd();

describe("Railway deployment config", () => {
  it("builds a standalone Next.js server for Railway", () => {
    const nextConfig = readFileSync(join(root, "next.config.ts"), "utf8");

    expect(nextConfig).toContain('output: "standalone"');
  });

  it("starts the standalone server on Railway", () => {
    const packageJson = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const railwayJson = JSON.parse(
      readFileSync(join(root, "railway.json"), "utf8"),
    ) as {
      build: { builder: string; buildCommand: string };
      deploy: {
        startCommand: string;
        healthcheckPath: string;
        healthcheckTimeout: number;
      };
    };

    expect(packageJson.scripts.start).toBe(
      "HOSTNAME=0.0.0.0 node .next/standalone/server.js",
    );
    expect(packageJson.scripts.build).toContain("next build");
    expect(packageJson.scripts.build).toContain(
      "npm run build:standalone-assets",
    );
    expect(packageJson.scripts["build:standalone-assets"]).toContain(
      ".next/standalone/.next/static",
    );
    expect(packageJson.scripts["build:standalone-assets"]).toContain(
      ".next/standalone/public",
    );
    expect(railwayJson.build.builder).toBe("RAILPACK");
    expect(railwayJson.build.buildCommand).toBe("npm run build");
    expect(railwayJson.deploy.startCommand).toBe(packageJson.scripts.start);
    expect(railwayJson.deploy.healthcheckPath).toBe("/api/health");
    expect(railwayJson.deploy.healthcheckTimeout).toBeGreaterThanOrEqual(120);
  });

  it("exposes a cheap Railway healthcheck", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("does not request Vercel-only analytics routes on Railway", () => {
    const rootLayout = readFileSync(join(root, "app/layout.tsx"), "utf8");

    expect(rootLayout).toContain(
      'const isVercelDeployment = process.env.VERCEL === "1"',
    );
    expect(rootLayout).toContain("isVercelDeployment ? (");
    expect(rootLayout).toContain("<Analytics />");
    expect(rootLayout).toContain("<SpeedInsights />");
  });
});
