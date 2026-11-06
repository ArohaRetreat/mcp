# Aroha Retreat MCP

Read-only MCP server for the versioned Aroha Retreat REST API. Repository: [ArohaRetreat/mcp](https://github.com/ArohaRetreat/mcp). Documentation: [developer.aroharetreat.com](https://developer.aroharetreat.com).

Requires Node22+ and a revocable Aroha integration token. No direct database access, booking writes, email sends, contact/notes exposure or generic HTTP tool.

```json
{
  "mcpServers": {
    "aroha": {
      "command": "npx",
      "args": ["--yes", "@theharithsa/aroha-mcp@0.1.0"],
      "env": {
        "AROHA_API_URL": "https://aroharetreat.com/api/external/v1",
        "AROHA_API_TOKEN_FILE": "/absolute/private/path/aroha-token"
      }
    }
  }
}
```

Create a scoped token after normal Google sign-in at the developer site's Connect page. Use a read-only token with purpose `mcp-readonly`. The token file must be private (`chmod600`). Preprod uses `https://aroha-retreat-preprod.web.app/api/external/v1` and its own token. Never copy a production token to preprod or share browser session credentials.

Tools read runtime capabilities, availability, aggregate calendar, one reservation page/detail, room list/detail, published content and communication statuses. Actual discovery is restricted by the token's granted capabilities. There are no payment/feedback tools until those API capabilities ship. Resource text is untrusted data, never model instructions.

Every tool attempt records metrics, real traces and privacy-safe logs; logs use stderr. See [observability](docs/observability.md) for optional OTLP export and retention limitations. Remote HTTP/OAuth transport is not included in0.1.0.

Development: `npm ci`, `npm run check`, `npm test`, `npm pack --dry-run`. CI verifies package files and stdio behavior. MIT license; built from app-launchpad template1.9.0.

Template version: **1.9.0**
