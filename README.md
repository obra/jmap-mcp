# Fastmail Aibo

An agent-first Model Context Protocol (MCP) server for Fastmail - email (via JMAP), calendar (via CalDAV), and contacts (via CardDAV).

**"Aibo" (相棒) means "partner" or "buddy" in Japanese - your AI's faithful companion for managing Fastmail.**

**Unlike other email integrations, this MCP is designed for how AI agents actually work** - not just a thin wrapper around raw APIs.

## What Makes This Different

Most MCPs expose raw protocols, forcing agents to make multiple calls to do simple things. This MCP follows different principles:

- **One call gets you useful data** - `search` returns summaries with previews, not just IDs that need another fetch
- **Bodies are always included** - `show` returns actual email content, not blob references to chase down
- **Flexible inputs everywhere** - Pass mailbox names ("Inbox"), roles ("archive"), or IDs - they all work
- **Smart caching** - Large bodies and attachments cached to disk automatically, token-efficient responses
- **Helpful errors** - Error messages include specific suggestions for recovery
- **Boolean search** - Combine flags with AND/OR/NOT logic, not just single-keyword filters

**Read the design philosophy:** [MCPs are not like other APIs](https://blog.fsck.com/2025/10/19/mcps-are-not-like-other-apis/)

## Origin

Based on [@wyattjoh/jmap-mcp](https://github.com/wyattjoh/jmap-mcp) by Wyatt Johnson. This fork takes a different design approach, focusing on agent workflows rather than raw API exposure, with additional features like boolean search logic, smart caching, and multiple output formats.

## Quick Start

### Prerequisites

- Node.js v18 or later
- A Fastmail account with API access
- Bearer token for authentication (API token)

### Installation

```bash
npm install fastmail-aibo
```

### Configuration

Add to your MCP client settings (e.g., Claude Code):

```json
{
  "mcpServers": {
    "fastmail": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "fastmail-aibo"],
      "env": {
        "JMAP_SESSION_URL": "https://api.fastmail.com/jmap/session",
        "JMAP_BEARER_TOKEN": "your-token-here",
        "FASTMAIL_USERNAME": "you@fastmail.com",
        "FASTMAIL_PASSWORD": "your-app-password"
      }
    }
  }
}
```

**Environment Variables:**

| Variable | Required | Description |
|----------|----------|-------------|
| `JMAP_SESSION_URL` | Yes | Fastmail JMAP endpoint (`https://api.fastmail.com/jmap/session`) |
| `JMAP_BEARER_TOKEN` | Yes | API token for email access |
| `FASTMAIL_USERNAME` | No* | Your Fastmail email address |
| `FASTMAIL_PASSWORD` | No* | App password for CalDAV/CardDAV |

\* Required for calendar and contacts access. Email-only usage needs just JMAP variables.

**Get your credentials:** Settings → Password & Security → App Passwords

## Email Tools

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
- Bodies >25KB: truncated inline, full version at `~/.cache/fastmail-aibo/{id}/body.txt`
- Attachments <100KB: auto-downloaded to `~/.cache/fastmail-aibo/{id}/attachments/`
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

## Calendar Tools

Calendar support via CalDAV. Requires `FASTMAIL_USERNAME` and `FASTMAIL_PASSWORD` environment variables.

### `calendars` - List calendars

Returns CSV with url, display_name, ctag, color, description.

```javascript
calendars()
```

### `events` - Get calendar events

Returns CSV with uid, url, summary, start, end, location, description, all_day.

```javascript
// All events
events()

// Events from a specific calendar
events({ calendar: "Personal" })

// Events in a date range
events({
  after: "2024-12-01",
  before: "2024-12-31"
})
```

### `create_event` - Create calendar events

Create events with optional attendees for automatic email invitations.

```javascript
// Simple event
create_event({
  summary: "Team Meeting",
  start: "2024-12-10T10:00:00Z",
  end: "2024-12-10T11:00:00Z",
  calendar: "Work"
})

// Event with attendees (sends email invitations automatically via iMIP)
create_event({
  summary: "Project Kickoff",
  start: "2024-12-15T14:00:00Z",
  end: "2024-12-15T15:00:00Z",
  location: "Conference Room A",
  description: "Q1 planning session",
  calendar: "Work",
  attendees: [
    { email: "bob@example.com", name: "Bob Smith", role: "required" },
    { email: "carol@example.com", role: "optional" }
  ],
  organizer: { email: "you@fastmail.com", name: "Your Name" }
})

// All-day event
create_event({
  summary: "Company Holiday",
  start: "2024-12-25",
  allDay: true
})

// Recurring event
create_event({
  summary: "Daily Standup",
  start: "2024-12-01T09:00:00Z",
  end: "2024-12-01T09:15:00Z",
  recurrence: {
    frequency: "daily",
    count: 30
  }
})

// Event with reminders
create_event({
  summary: "Important Meeting",
  start: "2024-12-10T10:00:00Z",
  reminders: [
    { days: 1 },           // 1 day before
    { hours: 1 },          // 1 hour before
    { minutes: 15 }        // 15 minutes before
  ]
})

// Event with all options
create_event({
  summary: "Quarterly Review",
  start: "2024-12-20T14:00:00Z",
  end: "2024-12-20T16:00:00Z",
  location: "Main Conference Room",
  description: "Q4 review and Q1 planning",
  calendar: "Work",
  status: "confirmed",        // confirmed, tentative, cancelled
  url: "https://zoom.us/j/123456789",  // Meeting link
  categories: ["Work", "Important"],
  priority: 2,                // 1=urgent, 2=high, 3=normal, 4=low
  transparency: "opaque",     // opaque (busy) or transparent (free)
  attendees: [
    { email: "team@example.com", name: "Team", role: "required", rsvp: true }
  ],
  organizer: { email: "you@fastmail.com" },
  reminders: [{ minutes: 30 }]
})
```

**Attendee options:**
- `email` (required): Attendee's email address
- `name` (optional): Display name
- `role`: `required` (default), `optional`, `non-participant`, `chair`
- `rsvp`: Request RSVP from attendee (default: true)

**Reminder options (specify one):**
- `days`: Days before event (e.g., 1 for day before)
- `hours`: Hours before event (e.g., 2 for 2 hours before)
- `minutes`: Minutes before event (e.g., 15)
- `action`: `display` (popup, default) or `email`

**iMIP invitations:** When you add attendees, Fastmail automatically sends calendar invitations via email. Responses (Accept/Decline/Maybe) are sent back automatically.

### `update_event` - Update existing events

Update any event field. Fields not specified are preserved.

```javascript
// Reschedule an event
update_event({
  calendar: "Work",
  eventId: "event-uid-123",
  start: "2024-12-15T15:00:00Z",
  end: "2024-12-15T16:00:00Z"
})

// Add attendees to existing event (sends invitations)
update_event({
  calendar: "Work",
  eventId: "event-uid-123",
  attendees: [
    { email: "newperson@example.com", name: "New Person" }
  ]
})

// Cancel an event (notifies attendees)
update_event({
  calendar: "Work",
  eventId: "event-uid-123",
  status: "cancelled"
})

// Clear optional fields
update_event({
  calendar: "Work",
  eventId: "event-uid-123",
  location: "",          // Clear location
  categories: [],        // Clear all categories
  reminders: [],         // Clear all reminders
  priority: null         // Clear priority
})
```

### `delete_event` - Delete calendar events

```javascript
delete_event({
  calendar: "Work",
  eventId: "event-uid-123"
})
```

## Contacts Tools

Contacts support via CardDAV. Requires `FASTMAIL_USERNAME` and `FASTMAIL_PASSWORD` environment variables.

### `address_books` - List address books

Returns CSV with url, display_name, ctag, description.

```javascript
address_books()
```

### `contacts` - Get or search contacts

Returns CSV with uid, url, full_name, emails, phones, organization.

```javascript
// All contacts
contacts()

// Contacts from a specific address book
contacts({ addressBook: "Personal" })

// Search contacts
contacts({ query: "john" })
```

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

## Development

### Setup

```bash
git clone https://github.com/obra/fastmail-aibo.git
cd fastmail-aibo
npm install
```

### Commands

```bash
npm run build       # Compile TypeScript to dist/
npm test            # Run test suite
npm start           # Run the MCP server
npm run lint        # Type check without emit
```

### Environment Variables

```bash
# Required for email
export JMAP_SESSION_URL="https://api.fastmail.com/jmap/session"
export JMAP_BEARER_TOKEN="your-bearer-token"
export JMAP_ACCOUNT_ID="optional-account-id"  # Auto-detected if omitted

# Required for calendar and contacts (CalDAV/CardDAV)
export FASTMAIL_USERNAME="you@fastmail.com"
export FASTMAIL_PASSWORD="your-app-password"
```

### Architecture

- **`src/mod.ts`** - MCP server setup, JMAP/CalDAV/CardDAV client initialization, tool registration
- **`src/tools/index.ts`** - Email tool implementations (search, show, send, update, mailboxes, identities)
- **`src/tools/calendar.ts`** - Calendar tool implementations (calendars, events)
- **`src/tools/contacts.ts`** - Contacts tool implementations (address_books, contacts)
- **`src/calendar.ts`** - CalDAV client and iCal parsing
- **`src/contacts.ts`** - CardDAV client and vCard parsing
- **`src/utils.ts`** - Shared utilities (mailbox resolution, flag parsing, formatters, caching)
- **`src/utils.test.ts`** - Tests for CSV and RFC 5322 escaping

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
- RFC 5322 for emails (familiar format)
- Truncate large bodies, cache full version
- Only download small attachments

## Troubleshooting

### "JMAP connection failed"

Check your environment variables:
```bash
echo $JMAP_SESSION_URL
echo $JMAP_BEARER_TOKEN
```

Verify the session URL is correct. Fastmail uses `https://api.fastmail.com/jmap/session`.

### "Email submission disabled"

Your account is read-only or doesn't have the `urn:ietf:params:jmap:submission` capability. Check with Fastmail support.

### "Mailbox not found"

List available mailboxes with the `mailboxes` tool. Mailbox names are case-sensitive.

### Sent emails appear as drafts

This was a compatibility issue fixed in v0.2.0+. Make sure you're running the latest version.

## Contributing

Bug reports and suggestions welcome! Please open an issue at https://github.com/obra/fastmail-aibo/issues

When reporting issues:
1. Check if the issue exists in the latest version
2. Provide error messages and reproduction steps

## License

MIT License - see [LICENSE](LICENSE) file

## Related Resources

- [JMAP RFC 8620](https://datatracker.ietf.org/doc/html/rfc8620) - JMAP Core
- [JMAP RFC 8621](https://datatracker.ietf.org/doc/html/rfc8621) - JMAP for Mail
- [jmap-jam](https://github.com/htunnicliff/jmap-jam) - JMAP client library
- [tsdav](https://github.com/natelindev/tsdav) - CalDAV/CardDAV library
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP specification
- [Design philosophy blog post](https://blog.fsck.com/2025/10/19/mcps-are-not-like-other-apis/)
