import { readFile, stat } from "node:fs/promises";
import { context, trace } from "@opentelemetry/api";
export class ApiError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export function apiBase(value, allowLocal = false) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new ApiError("INVALID_API_URL");
  }
  const official = [
    "https://aroharetreat.com",
    "https://aroha-retreat-preprod.web.app",
  ].includes(u.origin);
  const local =
    allowLocal &&
    u.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  if (
    (!official && !local) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname.replace(/\/$/, "") !== "/api/external/v1"
  )
    throw new ApiError("INVALID_API_URL");
  return u.origin + "/api/external/v1";
}
export async function credential(env = process.env) {
  if (env.AROHA_API_TOKEN_FILE) {
    const s = await stat(env.AROHA_API_TOKEN_FILE);
    if (
      !s.isFile() ||
      s.size > 1024 ||
      (process.platform !== "win32" && s.mode & 0o077)
    )
      throw new ApiError("INSECURE_TOKEN_FILE");
    return (await readFile(env.AROHA_API_TOKEN_FILE, "utf8")).trim();
  }
  if (env.AROHA_API_TOKEN) return env.AROHA_API_TOKEN.trim();
  throw new ApiError("API_TOKEN_REQUIRED");
}
export function createApiClient({
  baseUrl,
  token,
  allowLocal = false,
  fetcher = fetch,
}) {
  const base = apiBase(baseUrl, allowLocal);
  if (!/^aroha_v1_(prd|ppr)_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/.test(token || ""))
    throw new ApiError("INVALID_API_TOKEN");
  return {
    base,
    async get(tool, args = {}) {
      let path = tool.path;
      const query = new URLSearchParams();
      for (const [k, v] of Object.entries(args)) {
        if (path.includes("{" + k + "}"))
          path = path.replace("{" + k + "}", encodeURIComponent(v));
        else if (Array.isArray(v)) {
          for (const x of v) query.append(k, String(x));
        } else if (v !== undefined) query.set(k, String(v));
      }
      if (
        !path.startsWith("/") ||
        path.includes("..") ||
        path.includes("{") ||
        !/^\/[a-z0-9_:/-]+$/.test(path)
      )
        throw new ApiError("INVALID_API_PATH");
      const url = base + path + (query.size ? "?" + query : "");
      const sc = trace.getSpan(context.active())?.spanContext();
      const headers = {
        Authorization: "Bearer " + token,
        Accept: "application/json",
        "X-Aroha-MCP-Operation": tool.operationId,
      };
      if (sc)
        headers.traceparent = `00-${sc.traceId}-${sc.spanId}-${sc.traceFlags === 1 ? "01" : "00"}`;
      let r;
      try {
        r = await fetcher(url, {
          method: "GET",
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        throw new ApiError("API_UNAVAILABLE");
      }
      if (Number(r.headers.get("content-length")) > 131072) {
        await r.body?.cancel();
        throw new ApiError("OUTPUT_TOO_LARGE", r.status);
      }
      const chunks = [];
      let size = 0;
      if (r.body)
        for await (const b of r.body) {
          size += b.length;
          if (size > 131072) throw new ApiError("OUTPUT_TOO_LARGE", r.status);
          chunks.push(b);
        }
      let data;
      try {
        data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new ApiError("INVALID_API_RESPONSE", r.status);
      }
      if (!r.ok) {
        const c = data?.error?.code;
        throw new ApiError(
          typeof c === "string" && /^[A-Z_]{1,64}$/.test(c)
            ? c
            : "API_REQUEST_FAILED",
          r.status,
        );
      }
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new ApiError("INVALID_API_RESPONSE", r.status);
      return {
        data,
        requestId: /^[a-f0-9-]{36}$/.test(r.headers.get("x-request-id") || "")
          ? r.headers.get("x-request-id")
          : undefined,
      };
    },
  };
}
