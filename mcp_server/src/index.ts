import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GraphError } from "./graph.js";
import { userTools } from "./tools/users.js";
import { calendarTools } from "./tools/calendar.js";
import { mailTools } from "./tools/mail.js";
import { fileTools } from "./tools/files.js";
import { teamTools } from "./tools/teams.js";

// Validate credentials on startup (throws if any are missing)
import "./config.js";

const server = new McpServer({
  name: "lnp-graph-mcp",
  version: "1.0.0",
});

// ──────────────────────────────────────────────
// Tool registry helper
// ──────────────────────────────────────────────

type ToolMap = Record<
  string,
  {
    description: string;
    schema: Record<string, z.ZodTypeAny>;
    handler: (args: Record<string, unknown>) => Promise<string>;
  }
>;

function registerTools(tools: ToolMap) {
  for (const [name, tool] of Object.entries(tools)) {
    server.tool(
      name,
      tool.description,
      tool.schema,
      async (args) => {
        try {
          const text = await tool.handler(args as Record<string, unknown>);
          return { content: [{ type: "text" as const, text }] };
        } catch (err) {
          if (err instanceof GraphError) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Graph API error ${err.status}: ${err.message}`,
                },
              ],
              isError: true,
            };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      }
    );
  }
}

// ──────────────────────────────────────────────
// Register all tool groups
// ──────────────────────────────────────────────

registerTools(userTools as unknown as ToolMap);
registerTools(calendarTools as unknown as ToolMap);
registerTools(mailTools as unknown as ToolMap);
registerTools(fileTools as unknown as ToolMap);
registerTools(teamTools as unknown as ToolMap);

// ──────────────────────────────────────────────
// Start stdio transport
// ──────────────────────────────────────────────

const transport = new StdioServerTransport();

server.connect(transport).then(() => {
  // Only write to stderr so stdout stays clean for MCP protocol messages
  process.stderr.write("LNP Graph MCP server started (stdio)\n");
});
