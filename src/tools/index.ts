// @ts-nocheck - jmap-jam ProxyAPI types don't expose options param (runtime supports it)
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type JamClient from "jmap-jam";
import type { Email, EmailCreate } from "jmap-jam";

import {
  cacheEmailBody,
  extractBodyText,
  formatAddress,
  formatAddresses,
  formatError,
  formatErrorText,
  formatFlags,
  getEmailCacheDir,
  getMailboxName,
  JMAP_OPTIONS,
  mcpResponse,
  parseAddresses,
  parseFlags,
  parseFlexibleDate,
  resolveIdentity,
  resolveMailbox,
  toCSV,
  toRFC5322,
} from "../utils.js";

// =============================================================================
// Schemas
// =============================================================================

const SearchSchema = z.object({
  text: z.string().optional().describe(
    "Free text search across all email fields",
  ),
  from: z.string().optional().describe(
    "Search by sender (matches any address containing this string)",
  ),
  to: z.string().optional().describe(
    "Search by recipient (matches any address containing this string)",
  ),
  subject: z.string().optional().describe("Search within subject line"),
  body: z.string().optional().describe("Search within email body"),
  mailbox: z.string().optional().describe(
    'Mailbox to search in (name, ID, or role like "inbox", "archive", "sent")',
  ),
  flags: z.array(z.string()).optional().describe(
    'Filter by flags: ["read"], ["!read", "flagged"]. Use ! prefix to negate.',
  ),
  thread: z.string().optional().describe("Thread ID - returns all emails in this conversation"),
  after: z.string().optional().describe(
    'Emails after this date (ISO 8601, YYYY-MM-DD, "yesterday", "today")',
  ),
  before: z.string().optional().describe(
    'Emails before this date (ISO 8601, YYYY-MM-DD, "yesterday", "today")',
  ),
  has_attachment: z.boolean().optional().describe(
    "Filter by attachment presence",
  ),
  limit: z.number().min(1).max(100).default(20).describe(
    "Maximum results (default 20)",
  ),
  offset: z.number().min(0).default(0).describe("Offset for pagination"),
});

const ShowSchema = z.object({
  id: z.string().describe("Email ID to retrieve"),
  format: z.enum(["text", "html"]).default("text").describe(
    "Preferred body format (default: text)",
  ),
});

const SendSchema = z.object({
  to: z.array(z.string()).min(1).describe(
    'Recipients: ["email@example.com"] or ["Name <email@example.com>"]',
  ),
  subject: z.string().optional().describe(
    "Email subject (auto-generated for replies/forwards if omitted)",
  ),
  body: z.string().describe("Email body (plain text)"),
  cc: z.array(z.string()).optional().describe("CC recipients"),
  bcc: z.array(z.string()).optional().describe("BCC recipients"),
  in_reply_to: z.string().optional().describe(
    "Email ID to reply to (auto-sets subject and threading headers)",
  ),
  forward_of: z.string().optional().describe(
    "Email ID to forward (auto-sets subject and includes original)",
  ),
  identity: z.string().describe(
    "Identity/from address to send from (email address or identity ID)",
  ),
  draft: z.boolean().default(false).describe(
    "Save as draft instead of sending",
  ),
});

const UpdateSchema = z.object({
  ids: z.array(z.string()).min(1).max(100).describe("Email IDs to update"),
  add_flags: z.array(z.string()).optional().describe(
    'Flags to add: ["read", "flagged"]',
  ),
  remove_flags: z.array(z.string()).optional().describe(
    'Flags to remove: ["flagged"]',
  ),
  move_to: z.string().optional().describe(
    "Move to mailbox (name, ID, or role)",
  ),
  archive: z.boolean().optional().describe("Move to Archive mailbox"),
  trash: z.boolean().optional().describe("Move to Trash mailbox"),
  delete: z.boolean().optional().describe(
    "Permanently delete (CANNOT be undone)",
  ),
});

const MailboxesSchema = z.object({
  parent: z.string().optional().describe("Filter by parent mailbox"),
});

const IdentitiesSchema = z.object({});

// =============================================================================
// Response Types & CSV Columns
// =============================================================================

// CSV column definitions for each response type
const SEARCH_COLUMNS = [
  "id",
  "thread_id",
  "date",
  "from",
  "subject",
  "flags",
  "mailbox",
  "has_attachment",
  "preview",
];
const MAILBOX_COLUMNS = ["id", "name", "role", "parent_id", "unread", "total"];
const IDENTITY_COLUMNS = ["id", "name", "email", "reply_to", "is_default"];

interface SearchResult {
  id: string;
  thread_id: string;
  subject: string;
  from: string;
  to: string[];
  date: string;
  preview: string;
  flags: string[];
  mailbox: string;
  has_attachment: boolean;
}

interface ShowResult {
  id: string;
  thread_id: string;
  message_id: string | null;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  reply_to: string[];
  date: string;
  flags: string[];
  headers: {
    list_unsubscribe?: string;
    list_id?: string;
    precedence?: string;
    auto_submitted?: string;
  };
  body: string;
  body_truncated: boolean;
  body_source: "text" | "html" | "preview";
  cache_path: string;
  attachments: { name: string; type: string; size: number }[];
}

interface MailboxResult {
  id: string;
  name: string;
  role: string | null;
  parent_id: string | null;
  unread: number;
  total: number;
}

interface IdentityResult {
  id: string;
  name: string;
  email: string;
  reply_to: string | null;
  is_default: boolean;
}

// =============================================================================
// Tool Registration
// =============================================================================

export function registerTools(
  server: McpServer,
  jam: JamClient,
  accountId: string,
  isReadOnly: boolean,
  hasSubmission: boolean,
) {
  // ---------------------------------------------------------------------------
  // search - Find emails with flexible filters, returns useful summaries
  // ---------------------------------------------------------------------------
  server.tool(
    "search",
    `Search emails. Returns summaries with id, thread_id, subject, from, date, preview, flags, mailbox.

Key features:
- thread: Pass a thread_id to get ALL emails in a conversation
- flags: Filter by any flag ["read", "!read", "flagged"] - use ! to negate
- mailbox: Use names ("Inbox"), roles ("archive", "sent", "trash"), or IDs
- dates: "yesterday", "today", "2024-01-15", or full ISO 8601`,
    SearchSchema.shape,
    async (args) => {
      try {
        // Build JMAP filter
        const filter: Record<string, unknown> = {};

        if (args.text) filter.text = args.text;
        if (args.from) filter.from = args.from;
        if (args.to) filter.to = args.to;
        if (args.subject) filter.subject = args.subject;
        if (args.body) filter.body = args.body;
        if (args.has_attachment !== undefined) {
          filter.hasAttachment = args.has_attachment;
        }

        // Resolve mailbox name/role to ID
        if (args.mailbox) {
          const resolved = await resolveMailbox(jam, accountId, args.mailbox);
          if (!resolved) {
            return mcpResponse(formatErrorText(
              `Mailbox not found: ${args.mailbox}`,
              'Use "mailboxes" tool to list available mailboxes',
            ));
          }
          filter.inMailbox = resolved.id;
        }

        // Handle flags filter
        if (args.flags && args.flags.length > 0) {
          for (const flag of args.flags) {
            const isNegated = flag.startsWith("!");
            const cleanFlag = isNegated ? flag.slice(1) : flag;
            const keyword = cleanFlag === "read"
              ? "$seen"
              : cleanFlag === "flagged"
              ? "$flagged"
              : cleanFlag === "replied"
              ? "$answered"
              : cleanFlag === "draft"
              ? "$draft"
              : `$${cleanFlag}`;

            if (isNegated) {
              filter.notKeyword = keyword;
            } else {
              filter.hasKeyword = keyword;
            }
          }
        }

        // Handle flexible dates
        if (args.after) {
          filter.after = parseFlexibleDate(args.after);
        }
        if (args.before) {
          filter.before = parseFlexibleDate(args.before);
        }

        // If searching by thread, use thread ID
        if (args.thread) {
          // Get thread to find email IDs
          const [threadResult] = await jam.api.Thread.get({
            accountId,
            ids: [args.thread],
          }, JMAP_OPTIONS);

          if (threadResult.list.length === 0) {
            return mcpResponse(formatErrorText(`Thread not found: ${args.thread}`));
          }

          const emailIds = threadResult.list[0].emailIds;

          // Fetch those emails directly
          const [emails] = await jam.api.Email.get({
            accountId,
            ids: emailIds,
            properties: [
              "id",
              "threadId",
              "subject",
              "from",
              "to",
              "receivedAt",
              "preview",
              "keywords",
              "mailboxIds",
              "hasAttachment",
            ],
            fetchTextBodyValues: true,
          }, JMAP_OPTIONS);

          const results = await Promise.all(
            emails.list.map((email: Email) =>
              formatEmailSummary(email, jam, accountId)
            ),
          );

          return mcpResponse(toCSV(results, SEARCH_COLUMNS));
        }

        // Regular search
        const [queryResult] = await jam.api.Email.query({
          accountId,
          filter: Object.keys(filter).length > 0 ? filter : undefined,
          limit: args.limit,
          position: args.offset,
          sort: [{ property: "receivedAt", isAscending: false }],
        }, JMAP_OPTIONS);

        if (queryResult.ids.length === 0) {
          return mcpResponse(toCSV([], SEARCH_COLUMNS, {
            total: queryResult.total || 0,
          }));
        }

        // Fetch email details
        const [emails] = await jam.api.Email.get({
          accountId,
          ids: queryResult.ids,
          properties: [
            "id",
            "threadId",
            "subject",
            "from",
            "to",
            "receivedAt",
            "preview",
            "keywords",
            "mailboxIds",
            "hasAttachment",
          ],
        }, JMAP_OPTIONS);

        const results = await Promise.all(
          emails.list.map((email: Email) =>
            formatEmailSummary(email, jam, accountId)
          ),
        );

        const hasMore = (queryResult.position || 0) + results.length <
          (queryResult.total || 0);
        return mcpResponse(toCSV(results, SEARCH_COLUMNS, {
          total: queryResult.total || results.length,
          ...(hasMore && { has_more: true }),
        }));
      } catch (error) {
        return mcpResponse(formatErrorText(formatError(error)));
      }
    },
  );

  // ---------------------------------------------------------------------------
  // show - Get full email with body, cached to disk
  // ---------------------------------------------------------------------------
  server.tool(
    "show",
    `Get full email content with body and headers.

Returns: id, thread_id, message_id, subject, from, to, cc, reply_to, date, flags, body, attachments
Headers: list_unsubscribe, list_id, precedence, auto_submitted (for detecting mailing lists/automated mail)
Bodies >25KB truncated inline but full version cached to ~/.cache/jmap-mcp/`,
    ShowSchema.shape,
    async (args) => {
      try {
        const [result] = await jam.api.Email.get({
          accountId,
          ids: [args.id],
          properties: [
            "id",
            "threadId",
            "messageId",
            "subject",
            "from",
            "to",
            "cc",
            "replyTo",
            "receivedAt",
            "keywords",
            "textBody",
            "htmlBody",
            "bodyValues",
            "attachments",
            "hasAttachment",
            "header:List-Unsubscribe:asText",
            "header:List-Id:asText",
            "header:Precedence:asText",
            "header:Auto-Submitted:asText",
          ],
          fetchTextBodyValues: true,
          fetchHTMLBodyValues: args.format === "html",
        }, JMAP_OPTIONS);

        if (result.list.length === 0) {
          return mcpResponse(formatErrorText(
            `Email not found: ${args.id}`,
            "The email may have been deleted or moved",
          ));
        }

        const email = result.list[0];

        // Extract body
        const body = extractBodyText(email);

        // Cache full body to disk
        let cachePath = "";
        try {
          // Get raw body for caching (not truncated)
          let fullBody = "";
          if (email.textBody?.[0]?.partId && email.bodyValues) {
            fullBody = email.bodyValues[email.textBody[0].partId]?.value || "";
          } else if (email.htmlBody?.[0]?.partId && email.bodyValues) {
            fullBody = email.bodyValues[email.htmlBody[0].partId]?.value || "";
          }

          if (fullBody) {
            await cacheEmailBody(
              args.id,
              fullBody,
              body.source === "html" ? "html" : "text",
            );
            cachePath = getEmailCacheDir(args.id);
          }
        } catch {
          // Caching failed, continue without cache
        }

        // Process attachments
        const attachments: ShowResult["attachments"] = (email.attachments || []).map(
          (att) => ({
            name: att.name || "unnamed",
            type: att.type || "application/octet-stream",
            size: att.size || 0,
          }),
        );

        // Extract headers (JMAP returns them as header:Name:asText properties)
        const headers: ShowResult["headers"] = {};
        // deno-lint-ignore no-explicit-any
        const emailAny = email as any;
        if (emailAny["header:List-Unsubscribe:asText"]) {
          headers.list_unsubscribe = emailAny["header:List-Unsubscribe:asText"];
        }
        if (emailAny["header:List-Id:asText"]) {
          headers.list_id = emailAny["header:List-Id:asText"];
        }
        if (emailAny["header:Precedence:asText"]) {
          headers.precedence = emailAny["header:Precedence:asText"];
        }
        if (emailAny["header:Auto-Submitted:asText"]) {
          headers.auto_submitted = emailAny["header:Auto-Submitted:asText"];
        }

        const showResult: ShowResult = {
          id: email.id,
          thread_id: email.threadId,
          message_id: Array.isArray(email.messageId)
            ? email.messageId[0]
            : (email.messageId || null),
          subject: email.subject || "(no subject)",
          from: email.from?.[0] ? formatAddress(email.from[0]) : "",
          to: formatAddresses(email.to),
          cc: formatAddresses(email.cc),
          reply_to: formatAddresses(email.replyTo),
          date: email.receivedAt || "",
          flags: formatFlags(email.keywords),
          headers,
          body: body.text,
          body_truncated: body.truncated,
          body_source: body.source,
          cache_path: cachePath,
          attachments,
        };

        return mcpResponse(toRFC5322(showResult));
      } catch (error) {
        return mcpResponse(formatErrorText(formatError(error)));
      }
    },
  );

  // ---------------------------------------------------------------------------
  // mailboxes - List all mailboxes with counts
  // ---------------------------------------------------------------------------
  server.tool(
    "mailboxes",
    "List mailboxes/folders with roles and message counts.",
    MailboxesSchema.shape,
    async (args) => {
      try {
        let filter: Record<string, unknown> | undefined;

        if (args.parent) {
          const resolved = await resolveMailbox(jam, accountId, args.parent);
          if (resolved) {
            filter = { parentId: resolved.id };
          }
        }

        const [queryResult] = await jam.api.Mailbox.query({
          accountId,
          filter,
          limit: 500,
          sort: [{ property: "sortOrder", isAscending: true }],
        }, JMAP_OPTIONS);

        const [mailboxes] = await jam.api.Mailbox.get({
          accountId,
          ids: queryResult.ids,
        }, JMAP_OPTIONS);

        const results: MailboxResult[] = mailboxes.list.map((m) => ({
          id: m.id,
          name: m.name,
          role: m.role || null,
          parent_id: m.parentId || null,
          unread: m.unreadEmails || 0,
          total: m.totalEmails || 0,
        }));

        return mcpResponse(toCSV(results, MAILBOX_COLUMNS));
      } catch (error) {
        return mcpResponse(formatErrorText(formatError(error)));
      }
    },
  );

  // ---------------------------------------------------------------------------
  // identities - List sending identities
  // ---------------------------------------------------------------------------
  if (hasSubmission) {
    server.tool(
      "identities",
      "List available sending identities (from addresses).",
      IdentitiesSchema.shape,
      async () => {
        try {
          const [queryResult] = await jam.api.Identity.query({
            accountId,
            limit: 100,
          }, JMAP_OPTIONS);

          const [identities] = await jam.api.Identity.get({
            accountId,
            ids: queryResult.ids,
          }, JMAP_OPTIONS);

          const results: IdentityResult[] = identities.list.map((id, idx) => ({
            id: id.id,
            name: id.name || "",
            email: id.email,
            reply_to: id.replyTo?.[0]?.email || null,
            is_default: idx === 0, // First is typically default
          }));

          return mcpResponse(toCSV(results, IDENTITY_COLUMNS));
        } catch (error) {
          return mcpResponse(formatErrorText(formatError(error)));
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Write operations (only if not read-only)
  // ---------------------------------------------------------------------------
  if (!isReadOnly) {
    // -------------------------------------------------------------------------
    // update - Bulk update emails (flags, move, delete)
    // -------------------------------------------------------------------------
    server.tool(
      "update",
      "Update emails: add/remove flags, move to mailbox, archive, trash, or delete. Supports bulk operations.",
      UpdateSchema.shape,
      async (args) => {
        try {
          // Handle delete separately
          if (args.delete) {
            const [result] = await jam.api.Email.set({
              accountId,
              destroy: args.ids,
            }, JMAP_OPTIONS);

            const deleted = result.destroyed?.length || 0;
            const failed = Object.keys(result.notDestroyed || {});
            if (failed.length > 0) {
              return mcpResponse(`Deleted ${deleted} emails, ${failed.length} failed: ${failed.join(", ")}`);
            }
            return mcpResponse(`Deleted ${deleted} emails`);
          }

          // Build updates
          const updates: Record<string, Partial<EmailCreate>> = {};

          // Resolve mailbox for move operations
          let targetMailboxId: string | undefined;

          if (args.archive) {
            const resolved = await resolveMailbox(jam, accountId, "archive");
            if (!resolved) {
              return mcpResponse(formatErrorText(
                "Archive mailbox not found",
                'Use "mailboxes" tool to find available mailboxes',
              ));
            }
            targetMailboxId = resolved.id;
          } else if (args.trash) {
            const resolved = await resolveMailbox(jam, accountId, "trash");
            if (!resolved) {
              return mcpResponse(formatErrorText(
                "Trash mailbox not found",
                'Use "mailboxes" tool to find available mailboxes',
              ));
            }
            targetMailboxId = resolved.id;
          } else if (args.move_to) {
            const resolved = await resolveMailbox(jam, accountId, args.move_to);
            if (!resolved) {
              return mcpResponse(formatErrorText(
                `Mailbox not found: ${args.move_to}`,
                'Use "mailboxes" tool to find available mailboxes',
              ));
            }
            targetMailboxId = resolved.id;
          }

          for (const id of args.ids) {
            const update: Partial<EmailCreate> = {};

            // Handle flags
            if (args.add_flags || args.remove_flags) {
              const keywords: Record<string, boolean> = {};

              if (args.add_flags) {
                const { add } = parseFlags(args.add_flags);
                Object.assign(keywords, add);
              }

              if (args.remove_flags) {
                for (const flag of args.remove_flags) {
                  const keyword = flag === "read"
                    ? "$seen"
                    : flag === "flagged"
                    ? "$flagged"
                    : flag === "replied"
                    ? "$answered"
                    : flag === "draft"
                    ? "$draft"
                    : `$${flag}`;
                  keywords[keyword] = false;
                }
              }

              update.keywords = keywords;
            }

            // Handle mailbox move
            if (targetMailboxId) {
              update.mailboxIds = { [targetMailboxId]: true };
            }

            updates[id] = update;
          }

          const [result] = await jam.api.Email.set({
            accountId,
            update: updates,
          }, JMAP_OPTIONS);

          const updated = Object.keys(result.updated || {}).length;
          const failed = Object.keys(result.notUpdated || {});
          if (failed.length > 0) {
            return mcpResponse(`Updated ${updated} emails, ${failed.length} failed: ${failed.join(", ")}`);
          }
          return mcpResponse(`Updated ${updated} emails`);
        } catch (error) {
          return mcpResponse(formatErrorText(formatError(error)));
        }
      },
    );

    // -------------------------------------------------------------------------
    // send - Compose and send email (with reply/forward support)
    // -------------------------------------------------------------------------
    if (hasSubmission) {
      server.tool(
        "send",
        `Send email. Requires identity (use identities tool to list available from addresses).

- in_reply_to: Email ID to reply to - auto-generates "Re: subject" and sets threading headers
- forward_of: Email ID to forward - auto-generates "Fwd: subject" and includes original
- subject: Required for new emails, optional for replies/forwards (auto-generated)
- draft: true to save as draft without sending`,
        SendSchema.shape,
        async (args) => {
          try {
            const to = parseAddresses(args.to);
            const cc = args.cc ? parseAddresses(args.cc) : undefined;
            const bcc = args.bcc ? parseAddresses(args.bcc) : undefined;

            let subject = args.subject || "";
            let body = args.body;
            let inReplyTo: string[] | undefined;
            let references: string[] | undefined;

            // Validate subject required for new emails (not replies/forwards)
            if (!args.subject && !args.in_reply_to && !args.forward_of) {
              return mcpResponse(formatErrorText(
                "Subject is required for new emails",
                "Provide subject, or use in_reply_to/forward_of for replies/forwards",
              ));
            }

            // Handle reply
            if (args.in_reply_to) {
              const [original] = await jam.api.Email.get({
                accountId,
                ids: [args.in_reply_to],
                properties: [
                  "id",
                  "subject",
                  "messageId",
                  "references",
                  "textBody",
                  "bodyValues",
                ],
                fetchTextBodyValues: true,
              }, JMAP_OPTIONS);

              if (original.list.length > 0) {
                const orig = original.list[0];

                // Set subject with Re: if needed
                if (!subject.toLowerCase().startsWith("re:")) {
                  const origSubject = orig.subject || "";
                  if (!origSubject.toLowerCase().startsWith("re:")) {
                    subject = `Re: ${origSubject}`;
                  } else {
                    subject = origSubject;
                  }
                }

                // Set threading headers
                if (orig.messageId) {
                  inReplyTo = Array.isArray(orig.messageId)
                    ? orig.messageId
                    : [orig.messageId];
                }

                if (orig.references) {
                  references = Array.isArray(orig.references)
                    ? [...orig.references, ...(inReplyTo || [])]
                    : [orig.references, ...(inReplyTo || [])];
                } else {
                  references = inReplyTo;
                }
              }
            }

            // Handle forward
            if (args.forward_of) {
              const [original] = await jam.api.Email.get({
                accountId,
                ids: [args.forward_of],
                properties: [
                  "id",
                  "subject",
                  "from",
                  "to",
                  "receivedAt",
                  "textBody",
                  "bodyValues",
                ],
                fetchTextBodyValues: true,
              }, JMAP_OPTIONS);

              if (original.list.length > 0) {
                const orig = original.list[0];

                // Set subject with Fwd: if needed
                if (!subject.toLowerCase().startsWith("fwd:")) {
                  const origSubject = orig.subject || "";
                  if (!origSubject.toLowerCase().startsWith("fwd:")) {
                    subject = `Fwd: ${origSubject}`;
                  } else {
                    subject = origSubject;
                  }
                }

                // Include original message in body
                const origBody = extractBodyText(orig);
                const origFrom = orig.from?.[0]
                  ? formatAddress(orig.from[0])
                  : "unknown";
                const origDate = orig.receivedAt || "unknown";

                body =
                  `${body}\n\n---------- Forwarded message ----------\nFrom: ${origFrom}\nDate: ${origDate}\nSubject: ${
                    orig.subject || "(no subject)"
                  }\n\n${origBody.text}`;
              }
            }

            // Resolve drafts mailbox for email creation
            const draftsMailbox = await resolveMailbox(jam, accountId, "drafts");
            if (!draftsMailbox) {
              return mcpResponse(formatErrorText("Could not find Drafts mailbox"));
            }

            // Build email
            const emailData: EmailCreate = {
              mailboxIds: { [draftsMailbox.id]: true },
              subject,
              to,
              cc,
              bcc,
              keywords: { "$draft": true },
              bodyValues: {
                body: {
                  value: body,
                  isTruncated: false,
                  isEncodingProblem: false,
                },
              },
              textBody: [{ partId: "body", type: "text/plain" }],
              inReplyTo,
              references,
            };

            // Resolve identity
            const resolvedIdentity = await resolveIdentity(jam, accountId, args.identity);
            if (!resolvedIdentity) {
              return mcpResponse(formatErrorText(
                `Could not find identity: ${args.identity}`,
                'Use "identities" tool to list available identities',
              ));
            }
            emailData.from = [{
              email: resolvedIdentity.email,
              name: resolvedIdentity.name ?? undefined,
            }];

            // Create the email
            const [emailResult] = await jam.api.Email.set({
              accountId,
              create: { email: emailData },
            }, JMAP_OPTIONS);

            if (!emailResult.created?.email) {
              const createError = emailResult.notCreated?.email;
              return mcpResponse(formatErrorText(
                `Failed to create email: ${JSON.stringify(createError)}`,
              ));
            }

            const emailId = emailResult.created.email.id;

            // If draft mode, return without sending
            if (args.draft) {
              return mcpResponse(`Draft saved: ${emailId}`);
            }

            // Resolve sent mailbox for moving email after submission
            const sentMailbox = await resolveMailbox(jam, accountId, "sent");
            if (!sentMailbox) {
              return mcpResponse(formatErrorText("Could not find Sent mailbox"));
            }

            // Submit the email with instructions to move to Sent on success
            const [submissionResult] = await jam.api.EmailSubmission.set({
              accountId,
              create: {
                submission: {
                  emailId,
                  identityId: resolvedIdentity.id,
                },
              },
              // On successful submission, move to Sent and remove draft keyword
              onSuccessUpdateEmail: {
                "#submission": {
                  mailboxIds: { [sentMailbox.id]: true },
                  "keywords/$draft": null,
                },
              },
            }, JMAP_OPTIONS);

            if (!submissionResult.created?.submission) {
              const submitError = submissionResult.notCreated?.submission;
              return mcpResponse(formatErrorText(
                `Email created but submission failed: ${JSON.stringify(submitError)}`,
              ));
            }

            return mcpResponse(`Sent: ${emailId}`);
          } catch (error) {
            return mcpResponse(formatErrorText(formatError(error)));
          }
        },
      );
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

async function formatEmailSummary(
  email: Email,
  jam: JamClient,
  accountId: string,
): Promise<SearchResult> {
  // Get first mailbox name
  let mailboxName = "";
  if (email.mailboxIds) {
    const mailboxId = Object.keys(email.mailboxIds)[0];
    if (mailboxId) {
      mailboxName = await getMailboxName(jam, accountId, mailboxId);
    }
  }

  return {
    id: email.id,
    thread_id: email.threadId,
    subject: email.subject || "(no subject)",
    from: email.from?.[0] ? formatAddress(email.from[0]) : "",
    to: formatAddresses(email.to),
    date: email.receivedAt || "",
    preview: email.preview || "",
    flags: formatFlags(email.keywords),
    mailbox: mailboxName,
    has_attachment: email.hasAttachment || false,
  };
}
