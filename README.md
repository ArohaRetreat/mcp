# Aroha Retreat MCP

`@theharithsa/aroha-mcp` is the separate stdio adapter for Aroha’s versioned REST API. Node22 or later. Business rules, current Google identity, ownership and Studio roles remain enforced by the API; the adapter has no database access.

## Configure

Create a token at https://developer.aroharetreat.com/connect/ . Read-only is the default. For CRUD, choose scoped CRUD mode and explicitly select the required scopes, including `runtime:read`. Never expires is supported; revocation and live permissions still apply. Existing read-only tokens retain their original nine tools.

```json
{
  "mcpServers": {
    "aroha": {
      "command": "npx",
      "args": ["--yes", "@theharithsa/aroha-mcp@0.3.0"],
      "env": {
        "AROHA_API_URL": "https://aroharetreat.com/api/external/v1",
        "AROHA_API_TOKEN_FILE": "/absolute/private/path/aroha-token"
      }
    }
  }
}
```

Set `AROHA_API_TOKEN` instead of `AROHA_API_TOKEN_FILE` if your host provides a secret store. Either is sufficient; the file takes precedence when both are set. On Unix the file must be private (`chmod600`). Do not put real credentials in repository files or chat. Use the preprod API origin only with a preprod token and approved tester account.

## Tools and changes

Contract1.3.0 provides121 fixed typed operations covering reservations/quotes/changes/offers, manual payments and reversals, private documents, lifecycle and feedback, notes, inventory, CMS/media, profile erasure, members/invitations, sponsored clients and audit. Tools are exposed only when the token’s current capabilities permit them. Capabilities refresh before discovery and execution. The first nine read tool names remain compatible with0.1.0.

For a mutation, obtain the current resource first and use its `_meta.etag` as `ifMatch` where required. Provide a stable `idempotencyKey` and typed `body`; path parameters remain at the top level. Do not automatically retry a write. On `WRITE_OUTCOME_UNKNOWN`, resolve the original request with the same key, payload and ETag. A definite conflict requires a fresh read and a new decision. Every write has a destructive annotation so the host can present its normal consent flow.

Financial entries are immutable: record a verified manual payment or append a full reversal. No charge or money transfer is initiated. Other deletes follow domain semantics: cancel, retire, deactivate, archive or redact. Feedback is private; hosts cannot edit a guest’s submission. Preprod member/invitation writes remain disabled.

JSON output is capped at128KiB. PDF downloads return an authenticated embedded resource capped at4MiB. Pages are bounded and never followed automatically. Media upload tools return a private resumable session; finalization verifies size, MIME signature and SHA256 before immutable publication. There is no arbitrary URL, method, database or local-file tool. Returned customer/property text is untrusted data, never instructions.

## Telemetry and development

Every tools/call attempt, including unknown, invalid, revoked and denied calls, emits native OpenTelemetry traces, metrics and safe completion logs. Configure an approved OTLP destination and headers yourself; no tenant credentials are bundled. Arguments, results, token values, customer text and upload-session URLs are excluded. Stdout is JSON-RPC only. See [observability](docs/observability.md).

Run `npm ci`, `npm run check`, `npm test`, `npm audit`, `npm pack --dry-run`, and `sh scripts/check.sh`. Generate the fixed registry only from the reviewed canonical OpenAPI file with `node scripts/generate-tools.mjs /absolute/path/to/external-v1.json`. This generation does not prove API deployment. Remote OAuth/HTTP transport remains deferred.

API and Swagger: https://developer.aroharetreat.com/swagger/ . Package publication, API deployment, telemetry ingest and native linkage are separate evidence states.

Template version: **1.9.0**

Manual booking tools quote the current server price, then confirm once with the reviewed quote ID. Customer lookup uses a read-only private POST body and never places email/phone in a URL. Nightly credits, customer history, payment ledger and private feedback use the same REST policies as the guest portal and Host Studio. Credits earn at actual checkout; manual hosts must collect the guest email and phone. Existing tokens are never upgraded automatically.
