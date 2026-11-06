import contract from "./contract.json" with { type: "json" };
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/server/validators/ajv";
const validator = new AjvJsonSchemaValidator();
export const tools = Object.freeze(
  contract.tools.map((t) => {
    const check = validator.getValidator(t.inputSchema);
    return {
      ...t,
      schema: {
        safeParse(data) {
          const result = check(data);
          return result.valid ? { success: true, data } : { success: false };
        },
      },
    };
  }),
);
export const toolByName = new Map(tools.map((t) => [t.name, t]));

export const legacyReadOperations = Object.freeze([
  "getRuntime",
  "getAvailability",
  "getCalendar",
  "listReservations",
  "getReservation",
  "list_units",
  "get_units",
  "getPublishedContent",
  "listCommunications",
]);
