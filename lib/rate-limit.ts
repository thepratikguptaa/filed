interface RateLimitRecord {
  timestamps: number[];
}

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 20; // 20 req/min for browser/public clients
const AUTHED_MAX_REQUESTS = 120; // 120 req/min for authenticated API clients

const ipMap = new Map<string, RateLimitRecord>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of ipMap.entries()) {
    record.timestamps = record.timestamps.filter((ts) => now - ts < WINDOW_MS);
    if (record.timestamps.length === 0) ipMap.delete(key);
  }
}, 5 * 60 * 1000).unref?.();

export function getClientIp(request: Request): string {
  const headers = request.headers;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  return "127.0.0.1";
}

export function checkAuth(request: Request): { isAuthed: boolean; valid: boolean } {
  const secretKey = process.env.API_SECRET_KEY;
  if (!secretKey) return { isAuthed: false, valid: true };

  const authHeader = request.headers.get("authorization");
  const apiKeyHeader = request.headers.get("x-api-key");

  let token: string | null = null;
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (apiKeyHeader) {
    token = apiKeyHeader.trim();
  }

  if (!token) return { isAuthed: false, valid: true }; // Unauthenticated client
  return { isAuthed: true, valid: token === secretKey };
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  status?: number;
  error?: string;
}

export function checkRateLimit(request: Request): RateLimitResult {
  const auth = checkAuth(request);
  if (auth.isAuthed && !auth.valid) {
    return {
      allowed: false,
      remaining: 0,
      resetMs: 0,
      status: 401,
      error: "Invalid API authorization key.",
    };
  }

  const limit = auth.isAuthed ? AUTHED_MAX_REQUESTS : MAX_REQUESTS_PER_WINDOW;
  const ip = getClientIp(request);
  const now = Date.now();

  let record = ipMap.get(ip);
  if (!record) {
    record = { timestamps: [] };
    ipMap.set(ip, record);
  }

  // Filter timestamps within current window
  record.timestamps = record.timestamps.filter((ts) => now - ts < WINDOW_MS);

  if (record.timestamps.length >= limit) {
    const oldest = record.timestamps[0] ?? now;
    const resetMs = Math.max(0, WINDOW_MS - (now - oldest));
    return {
      allowed: false,
      remaining: 0,
      resetMs,
      status: 429,
      error: `Rate limit exceeded. Maximum ${limit} requests per minute.`,
    };
  }

  record.timestamps.push(now);
  const oldest = record.timestamps[0];
  const resetMs = Math.max(0, WINDOW_MS - (now - oldest));

  return {
    allowed: true,
    remaining: limit - record.timestamps.length,
    resetMs,
  };
}
