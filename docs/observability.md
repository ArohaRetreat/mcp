# MCP observability

Every valid tools/call attempt, including denied tools and invalid arguments, creates a real SDK span, one counter observation, one duration observation and one OTel completion log. Unknown tool names map to `unknown`, never arbitrary metric dimensions. Protocol messages rejected before tools/call dispatch are protocol errors, not invented tool executions.

Service `aroha-mcp`, namespace `aroha-retreat`, actual package version and production/pre-prod resource identity. Metrics: `aroha.mcp.tool.calls` and `aroha.mcp.tool.duration` (seconds), bounded tool/outcome/error dimensions. Logs carry the active SDK context; the fixed downstream GET forwards real W3C traceparent. No arguments, results, guest names/contacts, notes, tokens, private URLs or raw errors are logged/exported.

One sanitized completion log goes to stderr. Stdout is JSON-RPC only. OTel providers are always instantiated; configure `OTEL_EXPORTER_OTLP_ENDPOINT` and optional `OTEL_EXPORTER_OTLP_HEADERS` in the host environment to export traces/logs/metrics to your approved collector or Dynatrace. No tenant secret or default collection destination ships in the npm package. Without an endpoint, OTel observations are discarded after local processing and sanitized stderr logs remain. This is not centralized ingestion evidence.

For Dynatrace use an approved endpoint ending `/api/v2/otlp`, with separately configured API-token headers. Tokens stay in host configuration/secret store, never tool arguments or source. Export interval60s, bounded queues256/batch32, export timeout1.5s; flush on graceful shutdown. Telemetry exporter failure never converts a successful API operation to a business failure. Abrupt process termination can lose queued observations.

API request IDs and real trace context provide correlation; sampling and tenant retention limit stored linkage. Collector acceptance, tenant searchability and native navigation must be verified independently. Package CI cannot certify a customer's exporter configuration. Local tests use synthetic collectors and no customer records.
