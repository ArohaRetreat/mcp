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
  if (
    !allowLocal &&
    token.startsWith("aroha_v1_ppr_") !== base.includes("preprod")
  )
    throw new ApiError("WRONG_ENVIRONMENT");
  async function request(tool, args = {}) {
    let path = tool.path;
    const method = tool.method || "GET";
    const readOnly=method==='GET'||tool.annotations?.readOnlyHint===true;
    if (!["GET", "POST", "PATCH", "DELETE"].includes(method))
      throw new ApiError("INVALID_API_METHOD");
    const query = new URLSearchParams();
    const parameters =
      tool.parameters ||
      Object.keys(args).map((name) => ({
        name,
        in: path.includes("{" + name + "}") ? "path" : "query",
      }));
    for (const p of parameters) {
      if (p.in === "header") continue;
      const v = args[p.name];
      if (v === undefined) continue;
      if (p.in === "path") {
        if (typeof v !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(v))
          throw new ApiError("INVALID_API_PATH");
        path = path.replace("{" + p.name + "}", encodeURIComponent(v));
      } else if (p.in === "query") {
        if (Array.isArray(v))
          for (const x of v) query.append(p.name, String(x));
        else query.set(p.name, String(v));
      }
    }
    if (
      !path.startsWith("/") ||
      path.includes("..") ||
      path.includes("{") ||
      !/^\/(?:[A-Za-z0-9_:/-]|%[A-F0-9]{2})+$/.test(path)
    )
      throw new ApiError("INVALID_API_PATH");
    const headers = {
      Authorization: "Bearer " + token,
      Accept: tool.binary ? "application/pdf" : "application/json",
      "X-Aroha-MCP-Operation": tool.operationId,
    };
    if (method !== "GET") {
      if(!readOnly){
        if (!/^[A-Za-z0-9-]{8,100}$/.test(args.idempotencyKey || ""))throw new ApiError("IDEMPOTENCY_KEY_REQUIRED");
        headers["Idempotency-Key"] = args.idempotencyKey;
      }
      headers["Content-Type"] = "application/json";
      if (args.ifMatch !== undefined) {
        if (
          typeof args.ifMatch !== "string" ||
          !/^"[a-z_]+:[A-Za-z0-9:_-]{1,128}:[0-9]+"$/.test(args.ifMatch)
        )
          throw new ApiError("INVALID_ETAG");
        headers["If-Match"] = args.ifMatch;
      }
    }
    const sc = trace.getSpan(context.active())?.spanContext();
    if (sc)
      headers.traceparent = `00-${sc.traceId}-${sc.spanId}-${sc.traceFlags === 1 ? "01" : "00"}`;
    let r;
    try {
      r = await fetcher(base + path + (query.size ? "?" + query : ""), {
        method,
        headers,
        ...(method === "GET" ? {} : { body: JSON.stringify(args.body || {}) }),
        redirect: "error",
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw new ApiError(
        readOnly ? "API_UNAVAILABLE" : "WRITE_OUTCOME_UNKNOWN",
      );
    }
    const max = tool.binary ? 4 * 1024 * 1024 : 131072;
    if (Number(r.headers.get("content-length")) > max) {
      await r.body?.cancel();
      throw new ApiError("OUTPUT_TOO_LARGE", r.status);
    }
    const chunks = [];
    let size = 0;
    try {
      if (r.body)
        for await (const chunk of r.body) {
          size += chunk.length;
          if (size > max) throw new ApiError("OUTPUT_TOO_LARGE", r.status);
          chunks.push(chunk);
        }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(
        readOnly ? "API_UNAVAILABLE" : "WRITE_OUTCOME_UNKNOWN",
      );
    }
    const bytes = Buffer.concat(chunks);
    const requestId = /^[a-f0-9-]{36}$/.test(
      r.headers.get("x-request-id") || "",
    )
      ? r.headers.get("x-request-id")
      : undefined;
    const etag = /^"[a-z_]+:[A-Za-z0-9:_-]{1,128}:[0-9]+"$/.test(
      r.headers.get("etag") || "",
    )
      ? r.headers.get("etag")
      : undefined;
    if (tool.binary && r.ok) {
      if (
        !r.headers.get("content-type")?.startsWith("application/pdf") ||
        bytes.subarray(0, 4).toString() !== "%PDF"
      )
        throw new ApiError("INVALID_API_RESPONSE", r.status);
      return {
        data: {
          documentId: args.documentId,
          contentType: "application/pdf",
          size,
        },
        binary: bytes,
        requestId,
        etag,
      };
    }
    let data;
    try {
      data = JSON.parse(bytes.toString("utf8"));
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
    return { data, requestId, etag };
  }
  return {
    base,
    request,
    get(tool, args = {}) {
      if (tool.method && tool.method !== "GET")
        throw new ApiError("READ_METHOD_REQUIRED");
      return request(tool, args);
    },
  };
}
