import { Server } from "@modelcontextprotocol/server";
import { tools, toolByName } from "./tools.mjs";
import { ApiError } from "./client.mjs";
import { safeErrorCode } from "./telemetry.mjs";
export function createServer({ client, telemetry, capabilities }) {
  const allowed = new Set(capabilities);
  const current = async () => {
    const r = await client.get({ path: "/runtime", operationId: "getRuntime" });
    if (!Array.isArray(r.data.capabilities))
      throw new ApiError("INVALID_CAPABILITIES");
    return new Set(r.data.capabilities.filter((id) => allowed.has(id)));
  };
  const server = new Server(
    { name: "aroha-mcp", version: "0.3.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler("tools/list", async () => {
    const live = await current();
    return {
      tools: tools
        .filter((t) => live.has(t.operationId))
        .map(
          ({ name, description, inputSchema, outputSchema, annotations }) => ({
            name,
            description,
            inputSchema,
            outputSchema,
            annotations,
          }),
        ),
    };
  });
  server.setRequestHandler("tools/call", async (request) => {
    const t = toolByName.get(request.params.name);
    const tool = t?.name || "unknown";
    try {
      return await telemetry.observe(tool, async () => {
        if (!t || !allowed.has(t.operationId))
          throw new ApiError("TOOL_NOT_ALLOWED");
        const parsed = t.schema.safeParse(request.params.arguments || {});
        if (!parsed.success) throw new ApiError("INVALID_ARGUMENTS");
        if (!(await current()).has(t.operationId))
          throw new ApiError("TOOL_NOT_ALLOWED");
        const result = await (client.request
          ? client.request(t, parsed.data)
          : client.get(t, parsed.data));
        return server.projectCallToolResult(
          {
            content: result.binary
              ? [
                  {
                    type: "resource",
                    resource: {
                      uri:
                        "aroha-document://" +
                        encodeURIComponent(result.data.documentId),
                      mimeType: "application/pdf",
                      blob: result.binary.toString("base64"),
                    },
                  },
                ]
              : [{ type: "text", text: JSON.stringify(result.data) }],
            structuredContent: result.data,
            ...(result.requestId || result.etag
              ? {
                  _meta: {
                    ...(result.requestId
                      ? { requestId: result.requestId }
                      : {}),
                    ...(result.etag ? { etag: result.etag } : {}),
                  },
                }
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
