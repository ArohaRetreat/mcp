import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createTelemetry } from "../src/telemetry.mjs";
test("native OTLP exporters send all three signals to a synthetic collector with bounded data", async () => {
  const received = [];
  const s = createServer(async (req, res) => {
    const chunks = [];
    for await (const b of req) chunks.push(b);
    received.push({
      path: req.url,
      body: Buffer.concat(chunks),
      type: req.headers["content-type"],
    });
    res.writeHead(200, { "content-type": "application/x-protobuf" });
    res.end();
  });
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const t = createTelemetry({
    endpoint: `http://127.0.0.1:${s.address().port}`,
    stderr: { write() {} },
  });
  try {
    await t.observe("aroha_get_runtime", async () => ({
      secret: "synthetic-sensitive-result",
    }));
    await t.flush();
    assert.deepEqual(
      new Set(received.map((x) => x.path)),
      new Set(["/v1/traces", "/v1/logs", "/v1/metrics"]),
    );
    assert.ok(
      received.every(
        (x) =>
          x.type === "application/x-protobuf" &&
          !x.body.includes(Buffer.from("synthetic-sensitive-result")),
      ),
    );
    assert.ok(
      received
        .find((x) => x.path === "/v1/metrics")
        .body.includes(Buffer.from("aroha.mcp.tool.calls")),
    );
  } finally {
    await t.shutdown();
    s.closeAllConnections();
    s.close();
  }
});
