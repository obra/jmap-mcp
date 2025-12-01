# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server that provides JMAP (JSON Meta
Application Protocol) email management tools. It's built with Deno and
integrates with JMAP-compliant email servers like FastMail, Cyrus IMAP, and
Stalwart Mail Server.

## Development Commands

### Building and Running

- `deno task start` - Run the MCP server
- `deno task watch` - Run with file watching for development
- `deno lint src/` - Lint source files
- `deno check src/mod.ts` - Type check
- `deno fmt src/` - Format source files

### Required Environment Variables

```bash
JMAP_SESSION_URL="https://your-jmap-server.com/.well-known/jmap"
JMAP_BEARER_TOKEN="your-bearer-token"
JMAP_ACCOUNT_ID="account-id"  # Optional, auto-detected if not provided
```

## Architecture

### Core Structure

- **Entry point**: `src/mod.ts` - MCP server setup, JMAP client initialization
- **Tools**: `src/tools/index.ts` - All tool implementations
- **Utilities**: `src/utils.ts` - Shared helpers (mailbox resolution, body extraction, error handling)

### Design Philosophy

This MCP is designed to help AI agents work with email, not just expose raw JMAP.
Key principles:

1. **One call, useful data** - `search` returns summaries, not just IDs
2. **Bodies always included** - `show` returns actual content, not blob references
3. **Flexible inputs** - Mailbox names, roles, or IDs all work
4. **Helpful errors** - Error messages include recovery suggestions
5. **Token efficient** - Bodies >25KB truncated inline, cached in full to disk

### Tools

| Tool | Purpose |
|------|---------|
| `search` | Find emails with flexible filters. Returns summaries (id, subject, from, date, preview, flags) |
| `show` | Get full email with body. Bodies >25KB truncated, full version cached to `~/.cache/jmap-mcp/` |
| `mailboxes` | List folders with roles and message counts |
| `identities` | List available sending identities |
| `update` | Bulk operations: flags, move, archive, trash, delete |
| `send` | Compose and send. Supports reply (`in_reply_to`) and forward (`forward_of`) |

### Key Utilities

- **`resolveMailbox()`** - Converts "Inbox", "archive", or IDs to mailbox ID
- **`parseFlexibleDate()`** - Accepts "yesterday", "2024-01-15", or ISO 8601
- **`extractBodyText()`** - Gets text from email, HTML fallback with conversion
- **`formatFlags()`** - Converts JMAP keywords to friendly names (read, flagged, replied)

## Development Guidelines

### Adding New Tools

1. Define Zod schema in `src/tools/index.ts`
2. Implement handler using utility functions
3. Register in `registerTools()` with appropriate capability checks
4. Use `mcpResponse(successResponse(data))` or `mcpResponse(errorResponse(error))`

### Code Style

- Functional programming patterns
- `@ts-nocheck` at top of files that call JMAP with options param (type workaround)
- Error handling via `errorResponse()` with helpful suggestions
- All mailbox parameters should accept name, role, or ID via `resolveMailbox()`

### Response Format

All tools return consistent format:
```typescript
{
  success: true,
  data: { ... }
}
// or
{
  success: false,
  error: "message",
  suggestion: "how to fix",
  retryable: boolean
}
```

### JMAP Considerations

- Email/thread IDs are server-specific strings
- Mailbox roles: inbox, archive, drafts, sent, trash, junk
- Keywords: $seen (read), $flagged, $answered (replied), $draft
- Body fetching requires `fetchTextBodyValues: true` option
