#!/usr/bin/env node
import {legacyReadOperations} from './tools.mjs';
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createApiClient, credential } from "./client.mjs";
import { createServer } from "./server.mjs";
import { createTelemetry, safeErrorCode } from "./telemetry.mjs";
if (process.argv.includes("--help")) {
  process.stdout.write(
    "Aroha MCP0.3.0 — scoped CRUD stdio server\nSet AROHA_API_URL to https://aroharetreat.com/api/external/v1 (or preprod).\nSet AROHA_API_TOKEN_FILE to a private scoped-token file (chmod600), or AROHA_API_TOKEN.\nOptional: OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS.\nDocs: https://developer.aroharetreat.com/mcp/\n",
  );
} else if (process.argv.includes("--version")) {
  process.stdout.write("0.3.0\n");
} else {
  let telemetry, handle;
  try {
    const baseUrl =
      process.env.AROHA_API_URL || "https://aroharetreat.com/api/external/v1";
    const client = createApiClient({
      baseUrl,
      token: await credential(),
      allowLocal: process.env.AROHA_MCP_ALLOW_LOCALHOST === "1",
    });
    const environment = baseUrl.includes("preprod") ? "pre-prod" : "production";
    const headers = Object.fromEntries(
      (process.env.OTEL_EXPORTER_OTLP_HEADERS || "")
        .split(",")
        .filter(Boolean)
        .map((x) => {
          const i = x.indexOf("=");
          if (i < 1) throw new Error("INVALID_OTLP_HEADERS");
          return [
            x.slice(0, i).trim(),
            decodeURIComponent(x.slice(i + 1).trim()),
          ];
        }),
    );
    telemetry = createTelemetry({ environment, headers });
    const runtime = await client.get({
      path: "/runtime",
      operationId: "getRuntime",
    });
    if (
      !["mcp-readonly","mcp"].includes(runtime.data.purpose) ||
      !Array.isArray(runtime.data.scopes) ||
      (runtime.data.purpose === "mcp-readonly" && runtime.data.scopes.some((s) => !s.endsWith(":read")))
    )
      throw Object.assign(new Error("MCP_TOKEN_REQUIRED"), {
        code: "MCP_TOKEN_REQUIRED",
      });
    if (!Array.isArray(runtime.data.capabilities))
      throw new Error("INVALID_CAPABILITIES");
    handle = serveStdio(
      () =>
        createServer({
          client,
          telemetry,
          capabilities: runtime.data.purpose==="mcp-readonly"?runtime.data.capabilities.filter(id=>legacyReadOperations.includes(id)):runtime.data.capabilities,
        }),
      {
        onerror: () => {
          process.stderr.write("MCP_PROTOCOL_ERROR\n");
        },
      },
    );
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      await handle.close();
      await telemetry.shutdown();
    };
    process.once("SIGINT", () => void close());
    process.once("SIGTERM", () => void close());
    process.stdin.once("end", () => void close());
  } catch (e) {
    await telemetry?.shutdown();
    process.stderr.write(safeErrorCode(e) + "\n");
    process.exitCode = 1;
  }
}
