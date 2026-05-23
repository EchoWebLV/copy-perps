import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

type RedisConfig = {
  url: string;
  token: string;
};

type MemoryValue = {
  value: string;
  expiresAtMs: number | null;
};

const memoryCache = new Map<string, MemoryValue>();
const localCacheDir = join(process.cwd(), ".next", "cache", "local-redis");

function redisConfig(): RedisConfig | null {
  if (process.env.NODE_ENV === "test") return null;

  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  if (!url || !token) return null;
  return {
    url: url.replace(/\/+$/, ""),
    token,
  };
}

async function redisCommand<T>(command: unknown[]): Promise<T | null> {
  const config = redisConfig();
  if (!config) return null;

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Redis command failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    result?: T;
    error?: string;
  };
  if (payload.error) {
    throw new Error(`Redis command failed: ${payload.error}`);
  }
  return payload.result ?? null;
}

function memoryGet(key: string): string | null {
  const hit = memoryCache.get(key);
  if (!hit) return null;
  if (hit.expiresAtMs !== null && hit.expiresAtMs <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return hit.value;
}

function localCachePath(key: string): string {
  const safeKey = createHash("sha256").update(key).digest("hex");
  return join(localCacheDir, `${safeKey}.json`);
}

async function fileGet(key: string): Promise<string | null> {
  const path = localCachePath(key);
  try {
    const hit = JSON.parse(await readFile(path, "utf8")) as MemoryValue;
    if (hit.expiresAtMs !== null && hit.expiresAtMs <= Date.now()) {
      memoryCache.delete(key);
      await rm(path, { force: true });
      return null;
    }
    memoryCache.set(key, hit);
    return hit.value;
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
}

async function fileSet(key: string, hit: MemoryValue): Promise<void> {
  await mkdir(localCacheDir, { recursive: true });
  const path = localCachePath(key);
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(hit), "utf8");
  await rename(tmpPath, path);
}

async function fileDelete(key: string): Promise<void> {
  await rm(localCachePath(key), { force: true });
}

function shouldUseFileFallback(): boolean {
  return process.env.NODE_ENV !== "test";
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  if (redisConfig()) {
    const value = await redisCommand<string>(["GET", key]);
    if (typeof value !== "string") return null;
    return JSON.parse(value) as T;
  }

  let value = memoryGet(key);
  if (value === null && shouldUseFileFallback()) {
    value = await fileGet(key);
  }
  return value === null ? null : (JSON.parse(value) as T);
}

export async function cacheSetJson(
  key: string,
  value: unknown,
  options: { ttlSeconds?: number } = {},
): Promise<void> {
  const serialized = JSON.stringify(value);

  if (redisConfig()) {
    const command =
      options.ttlSeconds && options.ttlSeconds > 0
        ? ["SET", key, serialized, "EX", Math.ceil(options.ttlSeconds)]
        : ["SET", key, serialized];
    await redisCommand<string>(command);
    return;
  }

  const hit = {
    value: serialized,
    expiresAtMs:
      options.ttlSeconds && options.ttlSeconds > 0
        ? Date.now() + Math.ceil(options.ttlSeconds) * 1000
        : null,
  };
  memoryCache.set(key, hit);
  if (shouldUseFileFallback()) {
    await fileSet(key, hit);
  }
}

export async function cacheDelete(key: string): Promise<void> {
  if (redisConfig()) {
    await redisCommand<number>(["DEL", key]);
    return;
  }
  memoryCache.delete(key);
  if (shouldUseFileFallback()) {
    await fileDelete(key);
  }
}
