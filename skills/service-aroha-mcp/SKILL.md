---
name: service-aroha-mcp
description: Maintain the read-only stdio Aroha MCP npm server.
---

# Aroha MCP

Owner ArohaRetreat. Node22+ ESM; CLI src/cli.mjs, protocol src/server.mjs, fixed registry src/tools.mjs, GET-only client src/client.mjs and native SDK src/telemetry.mjs. Read README and docs/observability.md plus continuation.

Never add business writes, direct database access, arbitrary URL/method/tool inputs or credentials to output. Website API owns all business policy. Only scoped mcp-readonly credentials and granted runtime capabilities may expose tools. Preserve bounded pages, response size, fixed official origins, redirect rejection, private token files, privacy-safe errors and untrusted-content notices. Stdout is JSON-RPC only.

All tools/call attempts including invalid arguments/unknown tools emit one bounded SDK trace, counter, latency and log. Preserve real traceparent and request IDs without inventing ancestry. No tenant secret/destination is bundled. Export is host-configured and independent of read success. No runtime telemetry assertion from CI/export acceptance alone.

Validate npm ci, npm run check, npm test, npm audit and npm pack --dry-run; foundation sh scripts/check.sh. Publish exact reviewed immutable version through npm with explicit task authorization; never overwrite a version. Keep MCP SDK protocol integration and all three synthetic OTLP signal tests. Record actual registry publication and API deployment separately.
