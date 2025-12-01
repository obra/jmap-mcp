# JMAP MCP Server

[![JSR](https://jsr.io/badges/@wyattjoh/jmap-mcp)](https://jsr.io/@wyattjoh/jmap-mcp)
[![JSR Score](https://jsr.io/badges/@wyattjoh/jmap-mcp/score)](https://jsr.io/@wyattjoh/jmap-mcp)
[![JSR Scope](https://jsr.io/badges/@wyattjoh)](https://jsr.io/@wyattjoh)

A Model Context Protocol (MCP) server that helps AI agents manage email through
JMAP (JSON Meta Application Protocol) servers. Built with Deno.

## Design Philosophy

This MCP is designed to help agents **work with email**, not just expose raw
JMAP. Key principles:

- **One call, useful data** - `search` returns summaries, not just IDs
- **Bodies always included** - `show` returns actual content, not blob
  references
- **Flexible inputs** - Mailbox names ("Inbox"), roles ("archive"), or IDs all
  work
- **Helpful errors** - Error messages include recovery suggestions
- **Token efficient** - Bodies >25KB truncated inline, cached in full to disk

## Features

### Tools

| Tool         | Purpose                                                              |
| ------------ | -------------------------------------------------------------------- |
| `search`     | Find emails with flexible filters. Returns summaries with body preview |
| `show`       | Get full email with body. Large bodies cached to `~/.cache/jmap-mcp/` |
| `mailboxes`  | List folders with roles (inbox, archive, sent, trash) and counts     |
| `identities` | List available sending identities (from addresses)                   |
| `update`     | Bulk operations: add/remove flags, move, archive, trash, delete      |
| `send`       | Compose and send. Supports reply and forward                         |

### Key Capabilities

- Accepts mailbox names ("Inbox"), roles ("archive"), or IDs interchangeably
- Flexible date parsing: "yesterday", "2024-01-15", or full ISO 8601
- Human-friendly flags: `read`, `flagged`, `replied` (no $ prefix needed)
- Full JMAP RFC 8620/8621 compliance via jmap-jam
- Works with FastMail, Cyrus IMAP, Stalwart Mail Server, Apache James

## Installation

### Prerequisites

- [Deno](https://deno.land/) v1.40 or later
- A JMAP-compliant email server
- Valid JMAP authentication credentials

### Setup

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "email": {
      "type": "stdio",
      "command": "deno",
      "args": [
        "run",
        "--allow-net",
        "--allow-env=JMAP_SESSION_URL,JMAP_BEARER_TOKEN,JMAP_ACCOUNT_ID",
        "--allow-read",
        "--allow-write=$HOME/.cache/jmap-mcp",
        "jsr:@wyattjoh/jmap-mcp"
      ],
      "env": {
        "JMAP_SESSION_URL": "https://api.fastmail.com/jmap/session",
        "JMAP_BEARER_TOKEN": "YOUR_API_TOKEN"
      }
    }
  }
}
```

## Usage

### Environment Variables

| Variable            | Required | Description                              |
| ------------------- | -------- | ---------------------------------------- |
| `JMAP_SESSION_URL`  | Yes      | JMAP server session URL                  |
| `JMAP_BEARER_TOKEN` | Yes      | Bearer token for authentication          |
| `JMAP_ACCOUNT_ID`   | No       | Account ID (auto-detected if not provided) |

### Tools Reference

#### `search`

Find emails with flexible filters. Returns summaries directly (no second call needed).

**Parameters:**

- `text` - Free text search across all fields
- `from` - Search by sender
- `to` - Search by recipient
- `subject` - Search within subject
- `body` - Search within body
- `mailbox` - Mailbox name ("Inbox"), role ("archive"), or ID
- `flags` - Filter: `["read"]`, `["!read", "flagged"]`. Use `!` to negate.
- `after` / `before` - Dates: "yesterday", "2024-01-15", or ISO 8601
- `has_attachment` - Filter by attachment presence
- `thread` - Get all messages in a thread
- `limit` - Max results (default 20)
- `offset` - Pagination offset

**Returns:** Array of `{id, thread_id, subject, from, to, date, preview, flags, mailbox, has_attachment}`

#### `show`

Get full email content including body.

**Parameters:**

- `id` - Email ID
- `format` - "text" (default) or "html"

**Returns:** Full email with body. Bodies >25KB are truncated inline but cached in full to `~/.cache/jmap-mcp/{id}/body.txt`

#### `mailboxes`

List mailboxes/folders.

**Parameters:**

- `parent` - Optional parent mailbox filter

**Returns:** Array of `{id, name, role, parent_id, unread, total}`

#### `identities`

List available sending identities.

**Returns:** Array of `{id, name, email, reply_to, is_default}`

#### `update`

Bulk update emails.

**Parameters:**

- `ids` - Array of email IDs (max 100)
- `add_flags` - Flags to add: `["read", "flagged"]`
- `remove_flags` - Flags to remove
- `move_to` - Mailbox name, role, or ID
- `archive` - Shortcut to move to Archive
- `trash` - Shortcut to move to Trash
- `delete` - Permanently delete (cannot be undone)

#### `send`

Compose and send email.

**Parameters:**

- `to` - Recipients: `["email@example.com"]` or `["Name <email@example.com>"]`
- `subject` - Email subject
- `body` - Plain text body
- `cc` / `bcc` - Optional recipients
- `in_reply_to` - Email ID to reply to (handles threading automatically)
- `forward_of` - Email ID to forward (includes original)
- `identity` - Which "from" address to use
- `draft` - Set to true to save as draft without sending

## JMAP Server Compatibility

Works with any JMAP-compliant server:

- [FastMail](https://www.fastmail.com/) (commercial)
- [Cyrus IMAP](https://www.cyrusimap.org/) 3.0+
- [Stalwart Mail Server](https://stalw.art/)
- [Apache James](https://james.apache.org/)

## Development

```bash
# Run in development
deno task watch

# Lint and type check
deno lint src/ && deno check src/mod.ts

# Format
deno fmt src/
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Related Projects

- [jmap-jam](https://github.com/htunnicliff/jmap-jam) - JMAP client library
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP specification
- [JMAP RFC 8620](https://datatracker.ietf.org/doc/html/rfc8620) - JMAP core
- [JMAP RFC 8621](https://datatracker.ietf.org/doc/html/rfc8621) - JMAP for Mail
