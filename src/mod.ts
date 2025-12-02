#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import JamClient from "jmap-jam";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

import { registerTools } from "./tools/index.js";
import { formatError } from "./utils.js";

const JMAPConfigSchema = z.object({
  sessionUrl: z.string().url().describe("JMAP server session URL"),
  bearerToken: z.string().min(1).describe("Bearer token for authentication"),
  accountId: z.string().optional().describe(
    "Account ID (will be auto-detected if not provided)",
  ),
});

const getJMAPConfig = () => {
  const sessionUrl = process.env.JMAP_SESSION_URL;
  const bearerToken = process.env.JMAP_BEARER_TOKEN;
  const accountId = process.env.JMAP_ACCOUNT_ID;

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
  const server = new McpServer(
    {
      name: "jmap",
      version: pkg.version,
    },
    {
      instructions: `JMAP Email MCP - Manage email through JMAP-compliant servers.

**Tools:**

- \`search\` - Find emails with flexible filters. Returns summaries (id, subject, from, date, preview, flags).
  - Accepts mailbox names ("Inbox"), roles ("archive"), or IDs
  - Flexible dates: "yesterday", "2024-01-15", or full ISO 8601
  - Flag filters with boolean logic:
    - AND: ["read", "flagged"] (must have both)
    - OR: ["read OR flagged"] (at least one)
    - NOT: ["!draft"] (must not have)
    - Combined: ["read OR flagged", "!draft"]
  - thread: Get all emails in a thread by thread_id

- \`show\` - Get full email with body, headers, and attachments.
  - Bodies >25KB: truncated inline, full cached to ~/.cache/jmap-mcp/
  - Attachments <100KB: auto-downloaded and cached
  - HTML emails: converted to markdown
  - Returns headers: list_unsubscribe, list_id, precedence, auto_submitted

- \`mailboxes\` - List folders with roles (inbox, archive, sent, trash) and message counts

- \`identities\` - List available sending identities (required for send)

- \`update\` - Bulk operations: add/remove flags, move to mailbox, archive, trash, or delete
  - Shortcuts: archive=true, trash=true
  - Accepts mailbox names/roles

- \`send\` - Compose and send. Requires identity (email address).
  - in_reply_to: Reply to email ID (auto-generates "Re: subject" and threading headers)
  - forward_of: Forward email ID (auto-generates "Fwd: subject" and includes original)
  - subject: Optional for replies/forwards (auto-generated), required for new emails
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

  registerTools(server, jam, accountId, config.bearerToken, account.isReadOnly, hasSubmission);

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
    process.exit(1);
  }

  await server.connect(transport);
  console.warn("JMAP MCP Server running on stdio");
};

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
  });
}
