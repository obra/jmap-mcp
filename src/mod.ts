import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import JamClient from "jmap-jam";

import deno from "../deno.json" with { type: "json" };
import { registerTools } from "./tools/index.ts";
import { formatError } from "./utils.ts";

const JMAPConfigSchema = z.object({
  sessionUrl: z.string().url().describe("JMAP server session URL"),
  bearerToken: z.string().min(1).describe("Bearer token for authentication"),
  accountId: z.string().optional().describe(
    "Account ID (will be auto-detected if not provided)",
  ),
});

const getJMAPConfig = () => {
  const sessionUrl = Deno.env.get("JMAP_SESSION_URL");
  const bearerToken = Deno.env.get("JMAP_BEARER_TOKEN");
  const accountId = Deno.env.get("JMAP_ACCOUNT_ID");

  if (!sessionUrl || !bearerToken) {
    throw new Error(
      "Missing required environment variables: JMAP_SESSION_URL and JMAP_BEARER_TOKEN",
    );
  }

  return JMAPConfigSchema.parse({
    sessionUrl,
    bearerToken,
    accountId,
  });
};

const createJAMClient = (config: z.infer<typeof JMAPConfigSchema>) => {
  return new JamClient({
    sessionUrl: config.sessionUrl,
    bearerToken: config.bearerToken,
  });
};

const createServer = async () => {
  const server = new McpServer({
    name: "jmap",
    version: deno.version,
    capabilities: {
      tools: {},
    },
    instructions: `JMAP Email MCP - Manage email through JMAP-compliant servers.

**Tools:**

- \`search\` - Find emails with flexible filters. Returns summaries (id, subject, from, date, preview, flags).
  - Accepts mailbox names ("Inbox"), roles ("archive"), or IDs
  - Flexible dates: "yesterday", "2024-01-15", or full ISO 8601
  - Flag filters: ["read"], ["!read", "flagged"]

- \`show\` - Get full email with body. Bodies >25KB truncated inline, full version cached to ~/.cache/jmap-mcp/

- \`mailboxes\` - List folders with roles (inbox, archive, sent, trash) and message counts

- \`identities\` - List available sending identities (from addresses)

- \`update\` - Bulk operations: add/remove flags, move to mailbox, archive, trash, or delete
  - Shortcuts: archive=true, trash=true
  - Accepts mailbox names/roles

- \`send\` - Compose and send. Supports:
  - in_reply_to: Email ID to reply to (auto-handles threading)
  - forward_of: Email ID to forward (includes original)
  - draft: true to save without sending

**Flags:** read, flagged, replied, draft (no $ prefix needed)

**Mailbox resolution:** Use names ("Inbox"), roles ("archive"), or IDs interchangeably.

Works with FastMail, Cyrus IMAP, Stalwart Mail Server, Apache James, and other JMAP servers.`,
  });

  const config = getJMAPConfig();
  const jam = createJAMClient(config);
  const accountId = config.accountId || await jam.getPrimaryAccount();
  const session = await jam.session;
  const account = session.accounts[accountId];

  if (!("urn:ietf:params:jmap:mail" in session.capabilities)) {
    throw new Error(
      "JMAP mail capabilities not supported but required for this server",
    );
  }

  const hasSubmission =
    "urn:ietf:params:jmap:submission" in session.capabilities &&
    !account.isReadOnly;

  registerTools(server, jam, accountId, account.isReadOnly, hasSubmission);

  console.warn("Registered JMAP email tools");
  if (hasSubmission) {
    console.warn("Email submission enabled");
  } else {
    console.warn(
      "Email submission disabled (read-only account or no submission capability)",
    );
  }

  return server;
};

const main = async () => {
  const transport = new StdioServerTransport();

  let server: McpServer;
  try {
    server = await createServer();
  } catch (error) {
    console.error("JMAP connection failed:", formatError(error));
    console.error(
      "Please check your JMAP_SESSION_URL and JMAP_BEARER_TOKEN environment variables.",
    );
    Deno.exit(1);
  }

  await server.connect(transport);
  console.warn("JMAP MCP Server running on stdio");
};

if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error in main():", error);
    Deno.exit(1);
  });
}
