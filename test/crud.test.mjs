import test from "node:test";
import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { tools } from "../src/tools.mjs";
import { createApiClient } from "../src/client.mjs";
const token = "aroha_v1_prd_" + "a".repeat(32) + "_" + "b".repeat(43);
test("generated tools cover typed CRUD and keep explicit write controls", () => {
  assert.equal(tools.length, 121);
  assert.equal(new Set(tools.map((t) => t.name)).size, 121);
  for (const t of tools) {
    assert.equal(t.annotations.readOnlyHint, t.method === "GET" || t.operationId === "lookupCustomers");
    if (!t.annotations.readOnlyHint)
      assert.ok(t.inputSchema.required.includes("idempotencyKey"));
    assert.ok(!t.inputSchema.properties.url);
    assert.ok(!t.inputSchema.properties.method);
  }
  const pay = tools.find((t) => t.operationId === "recordPayment");
  assert.equal(
    pay.schema.safeParse({
      id: "synthetic",
      body: {
        amountPaise: 1,
        method: "cash",
        receivedAt: Date.now(),
        verified: true,
      },
      idempotencyKey: "stable-key-0001",
      ifMatch: '"financial:synthetic:0"',
    }).success,
    true,
  );
  assert.equal(
    pay.schema.safeParse({
      id: "synthetic",
      body: { amountPaise: -1 },
      idempotencyKey: "short",
    }).success,
    false,
  );
});
test("uncertain writes are never retried and retain a bounded outcome code", async () => {
  let attempts = 0;
  const client = createApiClient({
    baseUrl: "https://aroharetreat.com/api/external/v1",
    token,
    fetcher: async () => {
      attempts++;
      throw Error("private upstream failure");
    },
  });
  await assert.rejects(
    client.request(
      tools.find((t) => t.operationId === "createUnit"),
      {
        idempotencyKey: "stable-key-0001",
        body: { name: "Synthetic", capacity: 1, rate: null },
      },
    ),
    (e) => e.code === "WRITE_OUTCOME_UNKNOWN",
  );
  assert.equal(attempts, 1);
});
test("stdio CRUD carries conditional headers and refreshes revoked capabilities", async () => {
  const requests = [];
  let capabilities = [
    "getRuntime",
    "createUnit",
    "updateUnit",
    "retireUnit",
    "downloadDocument",
    "lookupCustomers",
  ];
  const http = httpServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push({
      method: req.method,
      path: req.url,
      headers: req.headers,
      body: raw ? JSON.parse(raw) : null,
    });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("ETag", '"unit:synthetic:1"');
    if (req.url.endsWith("/runtime"))
      res.end(
        JSON.stringify({
          environment: "pre-prod",
          contractVersion: "1.3.0",
          purpose: "mcp",
          scopes: ["runtime:read", "inventory:write", "documents:download"],
          capabilities,
        }),
      );
    else if(req.url.endsWith("/customers/lookups"))res.end(JSON.stringify({items:[],hasMore:false}));
    else if (req.url.endsWith("/content")) {
      res.setHeader("Content-Type", "application/pdf");
      res.end(Buffer.from("%PDF-" + "0".repeat(400000)));
    } else
      res.end(
        JSON.stringify({
          id: "synthetic",
          name: "Synthetic Unit",
          capacity: 1,
          rate: null,
          active: false,
          ready: false,
          version: 1,
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
      AROHA_MCP_ALLOW_LOCALHOST: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let id = 0,
    stderr = "";
  child.stderr.on("data", (b) => (stderr += b));
  createInterface({ input: child.stdout }).on("line", (line) => {
    const v = JSON.parse(line);
    if (v.id !== undefined) {
      pending.get(v.id)?.(v);
      pending.delete(v.id);
    }
  });
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const n = ++id,
        timer = setTimeout(() => reject(Error("MCP_RESPONSE_TIMEOUT")), 10000);
      pending.set(n, (v) => {
        clearTimeout(timer);
        resolve(v);
      });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n",
      );
    });
  try {
    await call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "synthetic-crud-test", version: "1" },
    });
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
    const list = await call("tools/list", {});
    assert.equal(list.result.tools.length, 6);
    assert.ok(list.result.tools.some((t) => !t.annotations.readOnlyHint));
    assert.equal(list.result.tools.find(t=>t.name==='aroha_lookup_customers').annotations.readOnlyHint,true);
    const lookup=await call('tools/call',{name:'aroha_lookup_customers',arguments:{body:{mode:'email',search:'synthetic@example.test',limit:10}}});assert.ok(!lookup.result.isError,JSON.stringify(lookup));assert.deepEqual(lookup.result.structuredContent,{items:[],hasMore:false});const lookupHttp=requests.find(r=>r.path.endsWith('/customers/lookups'));assert.equal(lookupHttp.method,'POST');assert.equal(lookupHttp.headers['idempotency-key'],undefined);assert.equal(lookupHttp.body.search,'synthetic@example.test');

    const create = await call("tools/call", {
      name: "aroha_create_unit",
      arguments: {
        idempotencyKey: "create-unit-0001",
        body: { name: "Synthetic Unit", capacity: 1, rate: null },
      },
    });
    assert.ok(!create.result.isError, JSON.stringify(create));
    assert.equal(create.result._meta.etag, '"unit:synthetic:1"');
    const update = await call("tools/call", {
      name: "aroha_update_unit",
      arguments: {
        id: "synthetic",
        idempotencyKey: "update-unit-0001",
        ifMatch: create.result._meta.etag,
        body: { capacity: 1, rate: null, active: false },
      },
    });
    assert.ok(!update.result.isError, JSON.stringify(update));
    capabilities = capabilities.filter((x) => x !== "retireUnit");
    const denied = await call("tools/call", {
      name: "aroha_retire_unit",
      arguments: {
        id: "synthetic",
        idempotencyKey: "retire-unit-0001",
        ifMatch: create.result._meta.etag,
      },
    });
    assert.equal(denied.result.isError, true);
    assert.equal(requests.filter((r) => r.method === "DELETE").length, 0);
    capabilities.push("retireUnit");
    const retired = await call("tools/call", {
      name: "aroha_retire_unit",
      arguments: {
        id: "synthetic",
        idempotencyKey: "retire-unit-0001",
        ifMatch: create.result._meta.etag,
      },
    });
    assert.ok(!retired.result.isError, JSON.stringify(retired));
    const pdf = await call("tools/call", {
      name: "aroha_download_document",
      arguments: { id: "synthetic", documentId: "synthetic-document" },
    });
    assert.ok(!pdf.result.isError, JSON.stringify(pdf));
    assert.equal(pdf.result.content[0].resource.mimeType, "application/pdf");
    assert.equal(
      Buffer.from(pdf.result.content[0].resource.blob, "base64")
        .subarray(0, 4)
        .toString(),
      "%PDF",
    );
    const writes = requests.filter((r) => r.method !== "GET");
    assert.deepEqual(
      writes.map((r) => r.method),
      ["POST", "PATCH", "DELETE"],
    );
    assert.equal(writes[1].headers["if-match"], '"unit:synthetic:1"');
    assert.equal(writes[2].headers["idempotency-key"], "retire-unit-0001");
    assert.ok(writes.every((r) => r.headers.traceparent));
    child.stdin.end();
    await once(child, "exit");
    assert.equal(child.exitCode, 0);
    assert.ok(!stderr.includes("Synthetic Unit"));
    assert.ok(!stderr.includes(token));
  } finally {
    child.kill();
    http.closeAllConnections();
    http.close();
  }
});

test('private customer lookup is a typed read-only POST with no write key or uncertain-write label',async()=>{const lookup=tools.find(t=>t.operationId==='lookupCustomers');assert.equal(lookup.annotations.readOnlyHint,true);assert.equal(lookup.annotations.destructiveHint,false);assert.equal(lookup.inputSchema.properties.idempotencyKey,undefined);assert.equal(lookup.schema.safeParse({body:{mode:'email',search:'synthetic@example.test',limit:10}}).success,true);let request;const client=createApiClient({baseUrl:'https://aroharetreat.com/api/external/v1',token,fetcher:async(url,options)=>{request={url,options};return new Response(JSON.stringify({items:[],hasMore:false}),{status:200});}});await client.request(lookup,{body:{mode:'email',search:'synthetic@example.test'}});assert.equal(request.options.method,'POST');assert.equal(request.options.headers['Idempotency-Key'],undefined);assert.equal(request.url.includes('synthetic'),false);assert.equal(JSON.parse(request.options.body).search,'synthetic@example.test');const failed=createApiClient({baseUrl:'https://aroharetreat.com/api/external/v1',token,fetcher:async()=>{throw Error('synthetic');}});await assert.rejects(failed.request(lookup,{body:{mode:'name',search:'Synthetic'}}),e=>e.code==='API_UNAVAILABLE');});
