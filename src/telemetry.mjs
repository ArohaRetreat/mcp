import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { TracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace";
import {
  LoggerProvider,
  BatchLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  AggregationTemporality,
} from "@opentelemetry/sdk-metrics";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
const noopExporter = {
  export(items, cb) {
    cb({ code: 0 });
  },
  async shutdown() {},
  async forceFlush() {},
};
const code = (e) =>
  typeof e?.code === "string" && /^[A-Z_]{1,64}$/.test(e.code)
    ? e.code
    : "INTERNAL_ERROR";
export function createTelemetry({
  endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  headers = {},
  environment = "production",
  exporters,
  stderr = process.stderr,
  version = "0.3.0",
} = {}) {
  if (endpoint) {
    const u = new URL(endpoint);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !(
        u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))
      )
    )
      throw new Error("INVALID_OTLP_ENDPOINT");
  }
  const resource = resourceFromAttributes({
    "service.name": "aroha-mcp",
    "service.namespace": "aroha-retreat",
    "service.version": version,
    "deployment.environment.name": environment,
  });
  const options = (signal) => ({
    url: endpoint?.replace(/\/$/, "") + "/v1/" + signal,
    headers,
    timeoutMillis: 1500,
  });
  // No default exporter/tenant/credentials. Providers still count, trace and log every call.
  const ex =
    exporters ||
    (endpoint
      ? {
          traces: new OTLPTraceExporter(options("traces")),
          logs: new OTLPLogExporter(options("logs")),
          metrics: new OTLPMetricExporter({
            ...options("metrics"),
            temporalityPreference: AggregationTemporality.DELTA,
          }),
        }
      : { traces: noopExporter, logs: noopExporter, metrics: noopExporter });
  const limits = {
    maxQueueSize: 256,
    maxExportBatchSize: 32,
    scheduledDelayMillis: 1000,
    exportTimeoutMillis: 1500,
  };
  const tp = new TracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor({ exporter: ex.traces, ...limits }),
    ],
  });
  const lp = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor({ exporter: ex.logs, ...limits })],
  });
  const reader = new PeriodicExportingMetricReader({
    exporter: ex.metrics,
    exportIntervalMillis: 60000,
    exportTimeoutMillis: 1500,
  });
  const mp = new MeterProvider({ resource, readers: [reader] });
  const manager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(manager);
  trace.setGlobalTracerProvider(tp);
  const tracer = tp.getTracer("aroha-mcp", version),
    logger = lp.getLogger("aroha-mcp", version),
    meter = mp.getMeter("aroha-mcp", version);
  const count = meter.createCounter("aroha.mcp.tool.calls"),
    duration = meter.createHistogram("aroha.mcp.tool.duration", { unit: "s" });
  let closed = false;
  return {
    async observe(tool, fn) {
      return tracer.startActiveSpan(
        "mcp.tool.call",
        { attributes: { "mcp.tool.name": tool } },
        async (span) => {
          const started = performance.now();
          let outcome = "succeeded",
            error = "";
          try {
            return await fn();
          } catch (e) {
            outcome = "failed";
            error = code(e);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw e;
          } finally {
            const attrs = {
              "mcp.tool.name": tool,
              outcome,
              "error.code": error,
            };
            const elapsed = (performance.now() - started) / 1000;
            count.add(1, attrs);
            duration.record(elapsed, attrs);
            span.setAttributes(attrs);
            logger.emit({
              context: context.active(),
              severityNumber: outcome === "failed" ? 17 : 9,
              body: "mcp.tool.completed",
              attributes: {
                ...attrs,
                "duration.ms": Math.round(elapsed * 1000),
              },
            });
            // One bounded local completion log, never arguments/results/tokens/raw exceptions.
            const c = span.spanContext();
            try {
              stderr.write(
                JSON.stringify({
                  event: "mcp.tool.completed",
                  tool,
                  outcome,
                  errorCode: error,
                  durationMs: Math.round(elapsed * 1000),
                  traceId: c.traceId,
                  spanId: c.spanId,
                }) + "\n",
              );
            } catch {}
            span.end();
          }
        },
      );
    },
    async flush() {
      await Promise.allSettled([
        tp.forceFlush(),
        lp.forceFlush(),
        mp.forceFlush(),
      ]);
    },
    async shutdown() {
      if (closed) return;
      closed = true;
      await Promise.allSettled([tp.shutdown(), lp.shutdown(), mp.shutdown()]);
      manager.disable();
    },
  };
}
export { code as safeErrorCode };
