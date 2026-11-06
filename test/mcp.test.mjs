import test from "node:test";
import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { apiBase, createApiClient, ApiError } from "../src/client.mjs";
import { tools } from "../src/tools.mjs";
import { createTelemetry } from "../src/telemetry.mjs";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import {
  InMemoryMetricExporter,
  AggregationTemporality,
} from "@opentelemetry/sdk-metrics";
const token = "aroha_v1_prd_" + "a".repeat(32) + "_" + "b".repeat(43);
test("API transport rejects noncanonical destinations and does not forward redirects", async () => {
  for (const url of [
    "http://aroharetreat.com/api/external/v1",
    "https://aroharetreat.com.evil.test/api/external/v1",
    "https://user:secret@aroharetreat.com/api/external/v1",
    "https://aroharetreat.com/api/external/v1?token=x",
    "https://aroharetreat.com/api/v1",
  ])
    assert.throws(() => apiBase(url));
  let call;
  const c = createApiClient({
    baseUrl: "https://aroharetreat.com/api/external/v1",
    token,
    fetcher: async (u, o) => {
      call = { u, o };
      return new Response('{"items":[],"nextCursor":null}', { status: 200 });
    },
  });
  await c.get(
    tools.find((t) => t.operationId === "listReservations"),
    { limit: 1 },
  );
  assert.equal(call.o.method, "GET");
  assert.equal(call.o.redirect, "error");
  assert.ok(!call.u.includes(token));
});
test("API errors and oversized responses do not expose upstream bodies", async () => {
  for (const [body, status, expected] of [
    [
      '{"error":{"code":"FORBIDDEN","secret":"synthetic-secret"}}',
      403,
      "FORBIDDEN",
    ],
    ["synthetic-secret", 502, "INVALID_API_RESPONSE"],
  ]) {
    const c = createApiClient({
      baseUrl: "https://aroharetreat.com/api/external/v1",
      token,
      fetcher: async () => new Response(body, { status }),
    });
    await assert.rejects(
      () => c.get(tools[0]),
      (e) => e.code === expected && !e.message.includes("synthetic-secret"),
    );
  }
  const c = createApiClient({
    baseUrl: "https://aroharetreat.com/api/external/v1",
    token,
    fetcher: async () => new Response(" ".repeat(131073), { status: 200 }),
  });
  await assert.rejects(
    () => c.get(tools[0]),
    (e) => e.code === "OUTPUT_TOO_LARGE",
  );
});
test("every tool attempt emits real correlated spans/logs and metrics without payload data", async () => {
  const spans = new InMemorySpanExporter(),
    logs = new InMemoryLogRecordExporter(),
    metrics = new InMemoryMetricExporter(AggregationTemporality.DELTA);
  let stderr = "";
  const t = createTelemetry({
    exporters: { traces: spans, logs, metrics },
    stderr: {
      write: (s) => {
        stderr += s;
      },
    },
  });
  await t.observe("aroha_get_runtime", async () => ({
    private: "never-export-this",
  }));
  await assert.rejects(
    t.observe("unknown", async () => {
      throw new ApiError("TOOL_NOT_ALLOWED");
    }),
  );
  await t.flush();
  assert.equal(spans.getFinishedSpans().length, 2);
  assert.equal(logs.getFinishedLogRecords().length, 2);
  const names = JSON.stringify(metrics.getMetrics());
  assert.ok(names.includes("aroha.mcp.tool.calls"));
  assert.ok(names.includes("aroha.mcp.tool.duration"));
  const exported = JSON.stringify({
    spans: spans.getFinishedSpans().map((s) => s.attributes),
    logs: logs.getFinishedLogRecords().map((l) => ({
      body: l.body,
      attributes: l.attributes,
      spanContext: l.spanContext,
    })),
    stderr,
  });
  assert.ok(!exported.includes("never-export-this"));
  assert.ok(
    logs.getFinishedLogRecords()[0].spanContext.traceId ===
      spans.getFinishedSpans()[0].spanContext().traceId,
  );
  await t.shutdown();
});
test("real SDK stdio handshake, discovery, safe reads and denied/invalid calls preserve JSON-RPC stdout", async () => {
  const requests = [];
  const http = httpServer(async (req, res) => {
    requests.push({
      method: req.method,
      path: req.url,
      traceparent: req.headers.traceparent,
    });
    res.setHeader("Content-Type", "application/json");
    if (req.url.endsWith("/runtime"))
      res.end(
        JSON.stringify({
          environment: "pre-prod",
          contractVersion: "1.0.0",
          purpose: "mcp-readonly",
          scopes: ["runtime:read", "reservations:read"],
          capabilities: ["getRuntime", "listReservations"],
        }),
      );
    else res.end('{"items":[],"nextCursor":null}');
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const child = spawn(process.execPath, ["src/cli.mjs"], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      AROHA_API_URL: `http://127.0.0.1:${http.address().port}/api/external/v1`,
      AROHA_API_TOKEN: token,
      AROHA_MCP_ALLOW_LOCALHOST: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let stderr = "";
  let invalidStdout = false;
  child.stderr.on("data", (b) => {
    stderr += b;
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    let v;
    try {
      v = JSON.parse(line);
    } catch {
      invalidStdout = true;
      return;
    }
    if (v.id !== undefined) {
      pending.get(v.id)?.(v);
      pending.delete(v.id);
    }
  });
  let id = 0;
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      const timer = setTimeout(
        () => reject(new Error("MCP_RESPONSE_TIMEOUT")),
        5000,
      );
      pending.set(n, (v) => {
        clearTimeout(timer);
        resolve(v);
      });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n",
      );
    });
  try {
    const init = await call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "synthetic-test", version: "1.0.0" },
    });
    assert.ok(init.result?.serverInfo);
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
    const list = await call("tools/list", {});
    assert.equal(list.result.tools.length, 2);
    assert.ok(list.result.tools.every((t) => t.annotations.readOnlyHint));
    const good = await call("tools/call", {
      name: "aroha_list_reservations",
      arguments: { limit: 1 },
    });
    assert.deepEqual(good.result.structuredContent, {
      items: [],
      nextCursor: null,
    });
    const bad = await call("tools/call", {
      name: "aroha_list_reservations",
      arguments: { limit: 999, secret: "never-export-this" },
    });
    assert.equal(bad.result.isError, true);
    const denied = await call("tools/call", {
      name: "write_reservation",
      arguments: {},
    });
    assert.equal(denied.result.isError, true);
    child.stdin.end();
    await once(child, "exit");
    assert.equal(child.exitCode, 0);
    assert.equal(invalidStdout, false);
    assert.ok(!stderr.includes(token));
    assert.ok(!stderr.includes("never-export-this"));
    assert.ok(stderr.includes("INVALID_ARGUMENTS"));
    assert.ok(stderr.includes("TOOL_NOT_ALLOWED"));
    assert.ok(requests.every((r) => r.method === "GET"));
    assert.ok(
      requests.find((r) => r.path.includes("/reservations")).traceparent,
    );
  } finally {
    child.kill();
    http.closeAllConnections();
    http.close();
  }
});

test("CLI refuses a broader integration credential before exposing any tools", async () => {
  const http = httpServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        environment: "production",
        purpose: "integration",
        scopes: ["runtime:read", "reservations:create"],
        capabilities: ["getRuntime"],
      }),
    );
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const child = spawn(process.execPath, ["src/cli.mjs"], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      AROHA_API_URL: `http://127.0.0.1:${http.address().port}/api/external/v1`,
      AROHA_API_TOKEN: token,
      AROHA_API_TOKEN_FILE: "",
      AROHA_MCP_ALLOW_LOCALHOST: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (b) => (stdout += b));
  child.stderr.on("data", (b) => (stderr += b));
  try {
    await once(child, "exit");
    assert.equal(child.exitCode, 1);
    assert.equal(stdout, "");
    assert.ok(stderr.includes("MCP_TOKEN_REQUIRED"));
    assert.ok(!stderr.includes(token));
  } finally {
    child.kill();
    http.closeAllConnections();
    http.close();
  }
});
