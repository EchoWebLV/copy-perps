type RedisConfig = {
  url: string;
  token: string;
};

type MemoryValue = {
  value: string;
  expiresAtMs: number | null;
};

const memoryCache = new Map<string, MemoryValue>();

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

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  if (redisConfig()) {
    const value = await redisCommand<string>(["GET", key]);
    if (typeof value !== "string") return null;
    return JSON.parse(value) as T;
  }

  const value = memoryGet(key);
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

  memoryCache.set(key, {
    value: serialized,
    expiresAtMs:
      options.ttlSeconds && options.ttlSeconds > 0
        ? Date.now() + Math.ceil(options.ttlSeconds) * 1000
        : null,
  });
}

export async function cacheDelete(key: string): Promise<void> {
  if (redisConfig()) {
    await redisCommand<number>(["DEL", key]);
    return;
  }
  memoryCache.delete(key);
}
