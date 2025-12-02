# JMAP MCP Server

An agent-first Model Context Protocol (MCP) server for managing email through JMAP-compliant servers like FastMail, Cyrus IMAP, and Stalwart.

**Unlike other email integrations, this MCP is designed for how AI agents actually work with email** - not just a thin wrapper around raw JMAP APIs.

## What Makes This Different

Most email MCPs expose raw protocols, forcing agents to make multiple calls to do simple things. This MCP follows different principles:

- **One call gets you useful data** - `search` returns summaries with previews, not just IDs that need another fetch
- **Bodies are always included** - `show` returns actual email content, not blob references to chase down
- **Flexible inputs everywhere** - Pass mailbox names ("Inbox"), roles ("archive"), or IDs - they all work
- **Smart caching** - Large bodies and attachments cached to disk automatically, token-efficient responses
- **Helpful errors** - Error messages include specific suggestions for recovery
- **Boolean search** - Combine flags with AND/OR/NOT logic, not just single-keyword filters

**Read the design philosophy:** [MCPs are not like other APIs](https://blog.fsck.com/2025/10/19/mcps-are-not-like-other-apis/)

## Origin

This project was forked from [@wyattjoh/jmap-mcp](https://github.com/wyattjoh/jmap-mcp) but is essentially a complete rewrite (~95% new code). The original exposed raw JMAP APIs; this version takes a fundamentally different approach designed for agent workflows rather than API exposure.

**What's different:**
- Original: 9 tools exposing raw JMAP methods (Email/get, Email/query, etc.)
- This version: 6 agent-focused tools (search returns summaries, show returns bodies, etc.)
- Complete redesign of all tool implementations
- New utilities for flexible parsing, caching, and formatting
- Different output formats (CSV, RFC 5322 vs JSON)
- Ported from Deno to Node.js
- Added boolean flag logic, attachment caching, HTML-to-markdown

The original project structure and JMAP client integration patterns remain, but the implementation is new.

## Quick Start

### Prerequisites

- Node.js v18 or later
- A JMAP-compliant email server (FastMail, Cyrus IMAP, Stalwart, etc.)
- Bearer token for authentication

### Installation

```bash
npm install jmap-mcp
```

### Configuration

Add to your MCP client settings (e.g., Claude Code):

```json
{
  "mcpServers": {
    "email": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "jmap-mcp"],
      "env": {
        "JMAP_SESSION_URL": "https://api.fastmail.com/jmap/session",
        "JMAP_BEARER_TOKEN": "your-token-here"
      }
    }
  }
}
```

**FastMail users:** Get your API token at Settings → Password & Security → App Passwords

## Tools

### `search` - Find emails

Search with flexible filters. Returns CSV with id, thread_id, date, from, subject, flags, mailbox, has_attachment, preview.

```javascript
// Simple text search
search({ text: "invoice" })

// Complex boolean flags
search({
  flags: ["read OR flagged", "!draft"],
  after: "2024-01-01"
})

// All emails in a thread
search({ thread: "thread_abc123" })
```

**Flag filtering:**
- `["read", "flagged"]` - must have both (AND)
- `["read OR flagged"]` - must have at least one (OR)
- `["!draft"]` - must not be a draft (NOT)
- `["read OR flagged", "!draft"]` - complex: `(read OR flagged) AND (NOT draft)`

**Date filters:**
- `"yesterday"`, `"today"`
- `"2024-01-15"` (date only)
- `"2024-01-15T10:00:00Z"` (full ISO 8601)

**Mailbox filters:**
- By name: `"Inbox"`, `"Spam"`
- By role: `"archive"`, `"sent"`, `"trash"`, `"drafts"`
- By ID: `"mailbox123"`

### `show` - Get full email

Returns full email in RFC 5322 format with headers and body.

```javascript
show({ id: "email_id" })
```

**Smart caching:**
- Bodies >25KB: truncated inline, full version at `~/.cache/jmap-mcp/{id}/body.txt`
- Attachments <100KB: auto-downloaded to `~/.cache/jmap-mcp/{id}/attachments/`
- Cache paths included in response

**HTML emails:** Automatically converted to markdown for better readability and safety.

**Headers included:** List-Unsubscribe, List-Id, Precedence, Auto-Submitted (for detecting newsletters/automation)

### `send` - Compose and send

```javascript
// New email
send({
  to: ["recipient@example.com"],
  subject: "Hello",
  body: "Message here",
  identity: "you@example.com"
})

// Reply (auto-generates "Re: subject" and threading headers)
send({
  in_reply_to: "email_id",
  body: "Thanks for your message!",
  identity: "you@example.com"
})

// Forward (auto-generates "Fwd: subject" and includes original)
send({
  forward_of: "email_id",
  to: ["forward-to@example.com"],
  body: "FYI",
  identity: "you@example.com"
})

// Save as draft without sending
send({
  to: ["recipient@example.com"],
  subject: "Draft",
  body: "Work in progress",
  identity: "you@example.com",
  draft: true
})
```

**Note:** Subject is optional for replies/forwards (auto-generated from original).

### `update` - Bulk operations

```javascript
// Mark as read
update({
  ids: ["email1", "email2"],
  add_flags: ["read"]
})

// Archive multiple emails
update({
  ids: ["email1", "email2", "email3"],
  archive: true
})

// Move to folder and mark as read
update({
  ids: ["email1"],
  move_to: "Projects",
  add_flags: ["read"]
})

// Trash emails
update({
  ids: ["spam1", "spam2"],
  trash: true
})

// Permanent delete (cannot be undone!)
update({
  ids: ["old_email"],
  delete: true
})
```

### `mailboxes` - List folders

Returns CSV with id, name, role, parent_id, unread, total.

```javascript
mailboxes()  // All folders

mailboxes({ parent: "Archive" })  // Subfolders only
```

### `identities` - List sending addresses

Returns CSV with id, name, email, reply_to, is_default.

```javascript
identities()
```

Use the email address from results when calling `send`.

## Output Formats

**Lists (search, mailboxes, identities):** CSV format for token efficiency
```csv
id,subject,from,date
abc123,Meeting notes,john@example.com,2024-01-15T10:00:00Z
def456,Invoice,billing@company.com,2024-01-14T15:30:00Z
# total=245 has_more=true
```

**Single emails (show):** RFC 5322 format (standard email headers)
```
Message-ID: <msg123@mail.example.com>
Date: 2024-01-15T10:00:00Z
From: John Doe <john@example.com>
To: you@example.com
Subject: Meeting notes
X-Flags: read, flagged

Email body content here...
```

**Actions (send, update):** Plain text
```
Sent: email_id
Updated 5 emails
```

## Security

### Prompt Injection Prevention

- **HTML sanitization:** Strips `<script>`, `<iframe>`, `<object>`, `<embed>` tags
- **Link sanitization:** Removes `javascript:` and `data:` URLs
- **Header sanitization:** Collapses newlines to prevent header injection
- **Filename sanitization:** Removes path traversal characters from attachment names

### Authentication

Uses bearer tokens for JMAP authentication. Never stores credentials - tokens come from environment variables.

## JMAP Server Compatibility

Tested with:
- ✅ [FastMail](https://www.fastmail.com/)
- 🟡 [Cyrus IMAP](https://www.cyrusimap.org/) 3.0+ (should work, not tested)
- 🟡 [Stalwart Mail Server](https://stalw.art/) (should work, not tested)
- 🟡 [Apache James](https://james.apache.org/) (should work, not tested)

**Compatibility notes:**
- Uses standard JMAP RFC 8620 (core) and RFC 8621 (mail)
- Some JMAP extensions (like `onSuccessUpdateEmail`) not used for broader compatibility
- Works with servers that support basic JMAP mail capabilities

## Development

### Setup

```bash
git clone https://github.com/obra/jmap-mcp.git
cd jmap-mcp
npm install
```

### Commands

```bash
npm run build       # Compile TypeScript to dist/
npm test            # Run test suite (25 tests)
npm start           # Run the MCP server
npm run lint        # Type check without emit
```

### Environment Variables

```bash
export JMAP_SESSION_URL="https://api.fastmail.com/jmap/session"
export JMAP_BEARER_TOKEN="your-bearer-token"
export JMAP_ACCOUNT_ID="optional-account-id"  # Auto-detected if omitted
```

### Architecture

- **`src/mod.ts`** - MCP server setup, JMAP client initialization, tool registration
- **`src/tools/index.ts`** - All 6 tool implementations (search, show, send, update, mailboxes, identities)
- **`src/utils.ts`** - Shared utilities (mailbox resolution, flag parsing, formatters, caching)
- **`src/utils.test.ts`** - 25 torture tests for CSV and RFC 5322 escaping

### Key Design Patterns

**Liberal inputs, strict outputs (Postel's Law):**
- Accept mailbox names, roles, OR IDs
- Accept "yesterday", "2024-01-15", OR ISO 8601 dates
- Accept "read", "flagged", etc. (no $ prefix needed)
- Return consistent, well-formatted output

**Progressive disclosure:**
- Don't make agents chase references (blobIds, partIds)
- Include related data in one call (mailbox names with search results)
- Cache large data to disk, return paths

**Token efficiency:**
- CSV for lists (5-10x smaller than JSON)
- RFC 5322 for emails (I already know this format)
- Truncate large bodies, cache full version
- Only download small attachments

## Troubleshooting

### "JMAP connection failed"

Check your environment variables:
```bash
echo $JMAP_SESSION_URL
echo $JMAP_BEARER_TOKEN
```

Verify the session URL is correct for your server. FastMail uses `https://api.fastmail.com/jmap/session`.

### "Email submission disabled"

Your account is read-only or doesn't have the `urn:ietf:params:jmap:submission` capability. Check with your email provider.

### "Mailbox not found"

List available mailboxes with the `mailboxes` tool. Mailbox names are case-sensitive.

### Sent emails appear as drafts

This was a compatibility issue with Fastmail, fixed in v0.2.0+. Make sure you're running the latest version.

## Contributing

This is a personal project forked from [@wyattjoh/jmap-mcp](https://github.com/wyattjoh/jmap-mcp) with substantial modifications.

**Bug reports and suggestions welcome:**
1. Check if the issue exists in the latest version
2. Include your JMAP server type and version
3. Provide error messages and reproduction steps
4. Open an issue at https://github.com/obra/jmap-mcp/issues

**Note:** This fork has diverged significantly from upstream and is not compatible with the original.

## License

MIT License - see [LICENSE](LICENSE) file

## Related Resources

- [JMAP RFC 8620](https://datatracker.ietf.org/doc/html/rfc8620) - JMAP Core
- [JMAP RFC 8621](https://datatracker.ietf.org/doc/html/rfc8621) - JMAP for Mail
- [jmap-jam](https://github.com/htunnicliff/jmap-jam) - JMAP client library
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP specification
- [Design philosophy blog post](https://blog.fsck.com/2025/10/19/mcps-are-not-like-other-apis/)
