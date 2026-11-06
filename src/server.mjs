import { Server } from "@modelcontextprotocol/server";
import { tools, toolByName } from "./tools.mjs";
import { ApiError } from "./client.mjs";
import { safeErrorCode } from "./telemetry.mjs";
export function createServer({ client, telemetry, capabilities }) {
  const allowed = new Set(capabilities);
  const server = new Server(
    { name: "aroha-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler("tools/list", async () => ({
    tools: tools
      .filter((t) => allowed.has(t.operationId))
      .map(({ schema, path, operationId, ...t }) => t),
  }));
  server.setRequestHandler("tools/call", async (request) => {
    const t = toolByName.get(request.params.name);
    const tool = t?.name || "unknown";
    try {
      return await telemetry.observe(tool, async () => {
        if (!t || !allowed.has(t.operationId))
          throw new ApiError("TOOL_NOT_ALLOWED");
        const parsed = t.schema.safeParse(request.params.arguments || {});
        if (!parsed.success) throw new ApiError("INVALID_ARGUMENTS");
        const result = await client.get(t, parsed.data);
        return server.projectCallToolResult(
          {
            content: [{ type: "text", text: JSON.stringify(result.data) }],
            structuredContent: result.data,
            ...(result.requestId
              ? { _meta: { requestId: result.requestId } }
              : {}),
          },
          t.outputSchema,
        );
      });
    } catch (e) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: { code: safeErrorCode(e) } }),
          },
        ],
      };
    }
  });
  return server;
}
