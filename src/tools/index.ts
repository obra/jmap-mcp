// @ts-nocheck - jmap-jam ProxyAPI types don't expose options param (runtime supports it)
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type JamClient from "jmap-jam";
import type { Email, EmailCreate } from "jmap-jam";

import type { AttachmentInfo } from "../utils.ts";
import {
  cacheEmailBody,
  errorResponse,
  extractBodyText,
  formatAddress,
  formatAddresses,
  formatFlags,
  getEmailCacheDir,
  getMailboxName,
  JMAP_OPTIONS,
  mcpResponse,
  parseAddresses,
  parseFlags,
  parseFlexibleDate,
  resolveMailbox,
  successResponse,
} from "../utils.ts";

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
  thread: z.string().optional().describe("Get all messages in this thread"),
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
  subject: z.string().describe("Email subject"),
  body: z.string().describe("Email body (plain text)"),
  cc: z.array(z.string()).optional().describe("CC recipients"),
  bcc: z.array(z.string()).optional().describe("BCC recipients"),
  in_reply_to: z.string().optional().describe(
    "Email ID to reply to (handles threading automatically)",
  ),
  forward_of: z.string().optional().describe(
    "Email ID to forward (includes original)",
  ),
  identity: z.string().optional().describe("Identity/from address to use"),
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
// Response Types
// =============================================================================

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
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: string;
  flags: string[];
  body: string;
  body_truncated: boolean;
  body_source: "text" | "html" | "preview";
  cache_path: string;
  attachments: AttachmentInfo[];
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
    "Search emails. Returns summaries with subject, from, date, preview, flags. Supports flexible date formats and mailbox names.",
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
            return mcpResponse(
              errorResponse(new Error(`Mailbox not found: ${args.mailbox}`), {
                suggestion:
                  'Use the "mailboxes" tool to see available mailboxes.',
              }),
            );
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
            return mcpResponse(
              errorResponse(new Error(`Thread not found: ${args.thread}`)),
            );
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

          return mcpResponse(successResponse({
            emails: results,
            total: results.length,
            has_more: false,
          }));
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
          return mcpResponse(successResponse({
            emails: [],
            total: queryResult.total || 0,
            has_more: false,
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

        return mcpResponse(successResponse({
          emails: results,
          total: queryResult.total || results.length,
          has_more: (queryResult.position || 0) + results.length <
            (queryResult.total || 0),
        }));
      } catch (error) {
        return mcpResponse(errorResponse(error));
      }
    },
  );

  // ---------------------------------------------------------------------------
  // show - Get full email with body, cached to disk
  // ---------------------------------------------------------------------------
  server.tool(
    "show",
    "Get full email content including body. Bodies >25KB are truncated inline but cached in full to disk.",
    ShowSchema.shape,
    async (args) => {
      try {
        const [result] = await jam.api.Email.get({
          accountId,
          ids: [args.id],
          properties: [
            "id",
            "threadId",
            "subject",
            "from",
            "to",
            "cc",
            "receivedAt",
            "keywords",
            "textBody",
            "htmlBody",
            "bodyValues",
            "attachments",
            "hasAttachment",
          ],
          fetchTextBodyValues: true,
          fetchHTMLBodyValues: args.format === "html",
        }, JMAP_OPTIONS);

        if (result.list.length === 0) {
          return mcpResponse(
            errorResponse(new Error(`Email not found: ${args.id}`), {
              suggestion: "The email may have been deleted or moved.",
            }),
          );
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
        const attachments: AttachmentInfo[] = (email.attachments || []).map(
          (att) => ({
            name: att.name || "unnamed",
            type: att.type || "application/octet-stream",
            size: att.size || 0,
            blobId: att.blobId || "",
            cached: false,
          }),
        );

        const showResult: ShowResult = {
          id: email.id,
          thread_id: email.threadId,
          subject: email.subject || "(no subject)",
          from: email.from?.[0] ? formatAddress(email.from[0]) : "",
          to: formatAddresses(email.to),
          cc: formatAddresses(email.cc),
          date: email.receivedAt || "",
          flags: formatFlags(email.keywords),
          body: body.text,
          body_truncated: body.truncated,
          body_source: body.source,
          cache_path: cachePath,
          attachments,
        };

        return mcpResponse(successResponse(showResult));
      } catch (error) {
        return mcpResponse(errorResponse(error));
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

        return mcpResponse(successResponse({ mailboxes: results }));
      } catch (error) {
        return mcpResponse(errorResponse(error));
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

          return mcpResponse(successResponse({ identities: results }));
        } catch (error) {
          return mcpResponse(errorResponse(error));
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

            return mcpResponse(successResponse({
              deleted: result.destroyed?.length || 0,
              failed: Object.entries(result.notDestroyed || {}).map((
                [id, err],
              ) => ({
                id,
                error: String(err),
              })),
            }));
          }

          // Build updates
          const updates: Record<string, Partial<EmailCreate>> = {};

          // Resolve mailbox for move operations
          let targetMailboxId: string | undefined;

          if (args.archive) {
            const resolved = await resolveMailbox(jam, accountId, "archive");
            if (!resolved) {
              return mcpResponse(
                errorResponse(new Error("Archive mailbox not found"), {
                  suggestion:
                    'Use the "mailboxes" tool to find available mailboxes.',
                }),
              );
            }
            targetMailboxId = resolved.id;
          } else if (args.trash) {
            const resolved = await resolveMailbox(jam, accountId, "trash");
            if (!resolved) {
              return mcpResponse(
                errorResponse(new Error("Trash mailbox not found"), {
                  suggestion:
                    'Use the "mailboxes" tool to find available mailboxes.',
                }),
              );
            }
            targetMailboxId = resolved.id;
          } else if (args.move_to) {
            const resolved = await resolveMailbox(jam, accountId, args.move_to);
            if (!resolved) {
              return mcpResponse(
                errorResponse(new Error(`Mailbox not found: ${args.move_to}`), {
                  suggestion:
                    'Use the "mailboxes" tool to find available mailboxes.',
                }),
              );
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

          return mcpResponse(successResponse({
            updated: Object.keys(result.updated || {}).length,
            failed: Object.entries(result.notUpdated || {}).map((
              [id, err],
            ) => ({
              id,
              error: String(err),
            })),
          }));
        } catch (error) {
          return mcpResponse(errorResponse(error));
        }
      },
    );

    // -------------------------------------------------------------------------
    // send - Compose and send email (with reply/forward support)
    // -------------------------------------------------------------------------
    if (hasSubmission) {
      server.tool(
        "send",
        "Send email. Supports reply (in_reply_to) and forward (forward_of). Set draft=true to save without sending.",
        SendSchema.shape,
        async (args) => {
          try {
            const to = parseAddresses(args.to);
            const cc = args.cc ? parseAddresses(args.cc) : undefined;
            const bcc = args.bcc ? parseAddresses(args.bcc) : undefined;

            let subject = args.subject;
            let body = args.body;
            let inReplyTo: string[] | undefined;
            let references: string[] | undefined;

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

            // Build email
            const emailData: EmailCreate = {
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

            // Set identity/from if provided
            if (args.identity) {
              emailData.from = [{ email: args.identity }];
            }

            // Create the email
            const [emailResult] = await jam.api.Email.set({
              accountId,
              create: { email: emailData },
            }, JMAP_OPTIONS);

            if (!emailResult.created?.email) {
              return mcpResponse(
                errorResponse(new Error("Failed to create email")),
              );
            }

            const emailId = emailResult.created.email.id;

            // If draft mode, return without sending
            if (args.draft) {
              return mcpResponse(successResponse({
                drafted: true,
                id: emailId,
              }));
            }

            // Submit the email
            const [submissionResult] = await jam.api.EmailSubmission.set({
              accountId,
              create: {
                submission: {
                  emailId,
                  identityId: args.identity,
                },
              },
            }, JMAP_OPTIONS);

            const sent = !!submissionResult.created?.submission;

            return mcpResponse(successResponse({
              sent,
              id: emailId,
              submission_id: submissionResult.created?.submission?.id,
            }));
          } catch (error) {
            return mcpResponse(errorResponse(error));
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
