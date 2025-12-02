// @ts-nocheck - jmap-jam ProxyAPI types don't expose options param (runtime supports it)
import type JamClient from "jmap-jam";
import type { Email, EmailAddress, Mailbox } from "jmap-jam";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

// JMAP requires core capability in all requests
// deno-lint-ignore no-explicit-any
export const JMAP_OPTIONS: any = { using: ["urn:ietf:params:jmap:core"] };

const BODY_TRUNCATE_SIZE = 25 * 1024; // 25KB
const ATTACHMENT_CACHE_SIZE = 250 * 1024; // 250KB

// =============================================================================
// Error Handling
// =============================================================================

export interface ToolResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  suggestion?: string;
  retryable?: boolean;
}

export const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    return JSON.stringify(error, null, 2);
  }
  return String(error);
};

export const errorResponse = (
  error: unknown,
  context?: { suggestion?: string; retryable?: boolean },
): ToolResponse => {
  const message = formatError(error);

  // Detect error types and provide helpful suggestions
  let suggestion = context?.suggestion;
  let retryable = context?.retryable ?? false;

  if (message.includes("not found") || message.includes("notFound")) {
    suggestion = suggestion ||
      "The item may have been deleted or moved. Try searching again.";
    retryable = false;
  } else if (
    message.includes("network") || message.includes("fetch") ||
    message.includes("ECONNREFUSED")
  ) {
    suggestion = suggestion ||
      "Network error. Check your connection and try again.";
    retryable = true;
  } else if (message.includes("401") || message.includes("unauthorized")) {
    suggestion = suggestion ||
      "Authentication failed. Check your JMAP_BEARER_TOKEN.";
    retryable = false;
  } else if (message.includes("403") || message.includes("permission")) {
    suggestion = suggestion ||
      "Permission denied. Your account may be read-only.";
    retryable = false;
  } else if (message.includes("429") || message.includes("rate")) {
    suggestion = suggestion || "Rate limited. Wait a moment and try again.";
    retryable = true;
  }

  return {
    success: false,
    error: message,
    suggestion,
    retryable,
  };
};

export const successResponse = <T>(data: T): ToolResponse<T> => ({
  success: true,
  data,
});

// =============================================================================
// Address Formatting
// =============================================================================

export const formatAddress = (addr: EmailAddress): string => {
  if (addr.name) {
    return `${addr.name} <${addr.email}>`;
  }
  return addr.email;
};

export const formatAddresses = (
  addrs: EmailAddress[] | null | undefined,
): string[] => {
  if (!addrs) return [];
  return addrs.map(formatAddress);
};

export const parseAddress = (input: string): EmailAddress => {
  // Handle "Name <email>" format
  const match = input.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  // Plain email
  return { email: input.trim() };
};

export const parseAddresses = (inputs: string[]): EmailAddress[] => {
  return inputs.map(parseAddress);
};

// =============================================================================
// Flag/Keyword Formatting
// =============================================================================

// JMAP keywords to friendly names
const KEYWORD_MAP: Record<string, string> = {
  "$seen": "read",
  "$flagged": "flagged",
  "$answered": "replied",
  "$draft": "draft",
  "$forwarded": "forwarded",
};

const REVERSE_KEYWORD_MAP: Record<string, string> = {
  "read": "$seen",
  "flagged": "$flagged",
  "replied": "$answered",
  "draft": "$draft",
  "forwarded": "$forwarded",
};

export const formatFlags = (
  keywords: Record<string, boolean> | null | undefined,
): string[] => {
  if (!keywords) return [];
  return Object.entries(keywords)
    .filter(([_, value]) => value)
    .map(([key]) => KEYWORD_MAP[key] || key.replace(/^\$/, ""));
};

export const parseFlags = (
  flags: string[],
): { add: Record<string, boolean>; remove: string[] } => {
  const add: Record<string, boolean> = {};
  const remove: string[] = [];

  for (const flag of flags) {
    const isNegated = flag.startsWith("!");
    const cleanFlag = isNegated ? flag.slice(1) : flag;
    const jmapKeyword = REVERSE_KEYWORD_MAP[cleanFlag] || `$${cleanFlag}`;

    if (isNegated) {
      remove.push(jmapKeyword);
    } else {
      add[jmapKeyword] = true;
    }
  }

  return { add, remove };
};

// =============================================================================
// Date Parsing
// =============================================================================

export const parseFlexibleDate = (input: string): string => {
  const trimmed = input.trim().toLowerCase();

  // Already ISO 8601
  if (/^\d{4}-\d{2}-\d{2}T/.test(input)) {
    return input;
  }

  // Date only - add time
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return `${input}T00:00:00Z`;
  }

  // Relative dates
  const now = new Date();

  if (trimmed === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
      .toISOString();
  }

  if (trimmed === "yesterday") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
      .toISOString();
  }

  // Try parsing as date
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  throw new Error(
    `Cannot parse date: "${input}". Use ISO 8601 (YYYY-MM-DDTHH:MM:SSZ), YYYY-MM-DD, "today", or "yesterday".`,
  );
};

// =============================================================================
// Mailbox Resolution
// =============================================================================

// Standard JMAP mailbox roles
const MAILBOX_ROLES = [
  "inbox",
  "archive",
  "drafts",
  "sent",
  "trash",
  "junk",
  "important",
  "all",
] as const;

export type MailboxRole = typeof MAILBOX_ROLES[number];

export interface ResolvedMailbox {
  id: string;
  name: string;
  role: string | null;
}

let mailboxCache: Map<string, Mailbox> | null = null;
let mailboxCacheAccountId: string | null = null;

export const clearMailboxCache = () => {
  mailboxCache = null;
  mailboxCacheAccountId = null;
};

export const resolveMailbox = async (
  jam: JamClient,
  accountId: string,
  nameOrIdOrRole: string,
): Promise<ResolvedMailbox | null> => {
  // Refresh cache if needed
  if (mailboxCache === null || mailboxCacheAccountId !== accountId) {
    const [queryResult] = await jam.api.Mailbox.query({
      accountId,
      limit: 500,
    }, JMAP_OPTIONS);

    const [mailboxes] = await jam.api.Mailbox.get({
      accountId,
      ids: queryResult.ids,
    }, JMAP_OPTIONS);

    mailboxCache = new Map(mailboxes.list.map((m) => [m.id, m]));
    mailboxCacheAccountId = accountId;
  }

  const input = nameOrIdOrRole.toLowerCase();

  // Check if it's a role
  if (MAILBOX_ROLES.includes(input as MailboxRole)) {
    for (const mailbox of mailboxCache.values()) {
      if (mailbox.role?.toLowerCase() === input) {
        return { id: mailbox.id, name: mailbox.name, role: mailbox.role };
      }
    }
  }

  // Check if it's an ID
  const byId = mailboxCache.get(nameOrIdOrRole);
  if (byId) {
    return { id: byId.id, name: byId.name, role: byId.role ?? null };
  }

  // Check by name (case-insensitive)
  for (const mailbox of mailboxCache.values()) {
    if (mailbox.name.toLowerCase() === input) {
      return { id: mailbox.id, name: mailbox.name, role: mailbox.role ?? null };
    }
  }

  // Fuzzy match by name
  for (const mailbox of mailboxCache.values()) {
    if (mailbox.name.toLowerCase().includes(input)) {
      return { id: mailbox.id, name: mailbox.name, role: mailbox.role ?? null };
    }
  }

  return null;
};

export const getMailboxName = async (
  jam: JamClient,
  accountId: string,
  mailboxId: string,
): Promise<string> => {
  // Ensure cache is populated
  if (mailboxCache === null || mailboxCacheAccountId !== accountId) {
    await resolveMailbox(jam, accountId, "inbox"); // This populates the cache
  }

  const mailbox = mailboxCache?.get(mailboxId);
  return mailbox?.name ?? mailboxId;
};

// =============================================================================
// Identity Resolution
// =============================================================================

export interface ResolvedIdentity {
  id: string;
  email: string;
  name: string | null;
}

interface IdentityLike {
  id: string;
  email: string;
  name?: string | null;
}

let identityCache: Map<string, IdentityLike> | null = null;
let identityCacheAccountId: string | null = null;

export const clearIdentityCache = () => {
  identityCache = null;
  identityCacheAccountId = null;
};

export const resolveIdentity = async (
  jam: JamClient,
  accountId: string,
  emailOrId: string,
): Promise<ResolvedIdentity | null> => {
  // Refresh cache if needed
  if (identityCache === null || identityCacheAccountId !== accountId) {
    const [queryResult] = await jam.api.Identity.query({
      accountId,
      limit: 100,
    }, JMAP_OPTIONS);

    const [identities] = await jam.api.Identity.get({
      accountId,
      ids: queryResult.ids,
    }, JMAP_OPTIONS);

    identityCache = new Map(identities.list.map((i: IdentityLike) => [i.id, i]));
    identityCacheAccountId = accountId;
  }

  const input = emailOrId.toLowerCase();

  // Check if it's an ID
  const byId = identityCache.get(emailOrId);
  if (byId) {
    return { id: byId.id, email: byId.email, name: byId.name ?? null };
  }

  // Check by email (case-insensitive)
  for (const identity of identityCache.values()) {
    if (identity.email.toLowerCase() === input) {
      return { id: identity.id, email: identity.email, name: identity.name ?? null };
    }
  }

  return null;
};

// =============================================================================
// Body Extraction
// =============================================================================

export interface ExtractedBody {
  text: string;
  truncated: boolean;
  source: "text" | "html" | "preview";
  fullLength: number;
}

export const extractBodyText = (email: Email): ExtractedBody => {
  // Try text/plain first
  if (email.textBody && email.textBody.length > 0 && email.bodyValues) {
    const partId = email.textBody[0].partId;
    const bodyValue = email.bodyValues[partId];
    if (bodyValue?.value) {
      const text = bodyValue.value;
      const truncated = text.length > BODY_TRUNCATE_SIZE;
      return {
        text: truncated ? text.slice(0, BODY_TRUNCATE_SIZE) : text,
        truncated,
        source: "text",
        fullLength: text.length,
      };
    }
  }

  // Fall back to HTML, convert to plain text
  if (email.htmlBody && email.htmlBody.length > 0 && email.bodyValues) {
    const partId = email.htmlBody[0].partId;
    const bodyValue = email.bodyValues[partId];
    if (bodyValue?.value) {
      const text = htmlToText(bodyValue.value);
      const truncated = text.length > BODY_TRUNCATE_SIZE;
      return {
        text: truncated ? text.slice(0, BODY_TRUNCATE_SIZE) : text,
        truncated,
        source: "html",
        fullLength: text.length,
      };
    }
  }

  // Fall back to preview
  if (email.preview) {
    return {
      text: email.preview,
      truncated: true, // Preview is always truncated
      source: "preview",
      fullLength: -1, // Unknown
    };
  }

  return {
    text: "[No body content available]",
    truncated: false,
    source: "preview",
    fullLength: 0,
  };
};

const htmlToText = (html: string): string => {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

// =============================================================================
// Cache Management
// =============================================================================

const getCacheDir = (): string => {
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "/tmp";
  return join(home, ".cache", "jmap-mcp");
};

export const getEmailCacheDir = (emailId: string): string => {
  return join(getCacheDir(), "emails", emailId);
};

export const cacheEmailBody = async (
  emailId: string,
  body: string,
  source: "text" | "html",
): Promise<string> => {
  const dir = getEmailCacheDir(emailId);
  await ensureDir(dir);

  const filename = source === "html" ? "body.html" : "body.txt";
  const filepath = join(dir, filename);

  await Deno.writeTextFile(filepath, body);
  return filepath;
};

export interface AttachmentInfo {
  name: string;
  type: string;
  size: number;
  blobId: string;
  cached: boolean;
  cachePath?: string;
}

export const processAttachments = (
  email: Email,
  _jam: JamClient,
  _accountId: string,
): AttachmentInfo[] => {
  if (!email.attachments || email.attachments.length === 0) {
    return [];
  }

  const results: AttachmentInfo[] = [];

  for (const att of email.attachments) {
    const info: AttachmentInfo = {
      name: att.name || "unnamed",
      type: att.type || "application/octet-stream",
      size: att.size || 0,
      blobId: att.blobId || "",
      cached: false,
    };

    // For now, just mark as cached: false
    // TODO: Implement actual blob download for small attachments
    if (att.size && att.size < ATTACHMENT_CACHE_SIZE) {
      // Would download and cache here
      info.cached = false; // Not implemented yet
    }

    results.push(info);
  }

  return results;
};

// =============================================================================
// Response Formatting
// =============================================================================

// Escape a value for CSV (quote if contains comma, quote, or newline)
const csvEscape = (val: unknown): string => {
  if (val === null || val === undefined) return "";
  const str = Array.isArray(val) ? val.join(";") : String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

// Format array of objects as CSV
export const toCSV = (
  rows: Record<string, unknown>[],
  columns: string[],
  meta?: Record<string, unknown>,
): string => {
  if (rows.length === 0) return columns.join(",") + "\n(no results)";

  const header = columns.join(",");
  const dataRows = rows.map((row) =>
    columns.map((col) => csvEscape(row[col])).join(",")
  );

  let result = header + "\n" + dataRows.join("\n");

  // Append metadata if present
  if (meta && Object.keys(meta).length > 0) {
    const metaParts = Object.entries(meta)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    result += `\n# ${metaParts}`;
  }

  return result;
};

// Sanitize header value - collapse newlines/tabs to spaces
const sanitizeHeader = (val: string): string => {
  return val.replace(/[\r\n\t]+/g, " ").trim();
};

// Format email in RFC 5322 style
export const toRFC5322 = (email: {
  id: string;
  thread_id: string;
  message_id?: string | null;
  subject: string;
  from: string;
  to: string[];
  cc?: string[];
  reply_to?: string[];
  date: string;
  flags: string[];
  headers?: {
    list_unsubscribe?: string;
    list_id?: string;
    precedence?: string;
    auto_submitted?: string;
  };
  body: string;
  body_truncated?: boolean;
  body_source?: string;
  cache_path?: string;
  attachments?: { name: string; type: string; size: number }[];
}): string => {
  const lines: string[] = [];

  // Standard headers (sanitized to prevent newline injection)
  if (email.message_id) lines.push(`Message-ID: ${sanitizeHeader(email.message_id)}`);
  lines.push(`X-JMAP-Id: ${email.id}`);
  lines.push(`X-Thread-Id: ${email.thread_id}`);
  lines.push(`Date: ${email.date}`);
  lines.push(`From: ${sanitizeHeader(email.from)}`);
  if (email.to.length > 0) lines.push(`To: ${email.to.map(sanitizeHeader).join(", ")}`);
  if (email.cc && email.cc.length > 0) lines.push(`Cc: ${email.cc.map(sanitizeHeader).join(", ")}`);
  if (email.reply_to && email.reply_to.length > 0) {
    lines.push(`Reply-To: ${email.reply_to.map(sanitizeHeader).join(", ")}`);
  }
  lines.push(`Subject: ${sanitizeHeader(email.subject)}`);

  // Flags as custom header
  if (email.flags.length > 0) {
    lines.push(`X-Flags: ${email.flags.join(", ")}`);
  }

  // List headers (sanitized)
  if (email.headers?.list_unsubscribe) {
    lines.push(`List-Unsubscribe: ${sanitizeHeader(email.headers.list_unsubscribe)}`);
  }
  if (email.headers?.list_id) {
    lines.push(`List-Id: ${sanitizeHeader(email.headers.list_id)}`);
  }
  if (email.headers?.precedence) {
    lines.push(`Precedence: ${sanitizeHeader(email.headers.precedence)}`);
  }
  if (email.headers?.auto_submitted) {
    lines.push(`Auto-Submitted: ${sanitizeHeader(email.headers.auto_submitted)}`);
  }

  // Attachments (sanitized names)
  if (email.attachments && email.attachments.length > 0) {
    const attList = email.attachments
      .map((a) => `${sanitizeHeader(a.name)} (${a.type}, ${a.size} bytes)`)
      .join("; ");
    lines.push(`X-Attachments: ${attList}`);
  }

  // Cache info
  if (email.cache_path) {
    lines.push(`X-Cache-Path: ${email.cache_path}`);
  }
  if (email.body_truncated) {
    lines.push(`X-Body-Truncated: true (source: ${email.body_source})`);
  }

  // Blank line then body
  lines.push("");
  lines.push(email.body);

  return lines.join("\n");
};

// Format error response as plain text
export const formatErrorText = (
  error: string,
  suggestion?: string,
  retryable?: boolean,
): string => {
  let text = `Error: ${error}`;
  if (suggestion) text += `\nSuggestion: ${suggestion}`;
  if (retryable) text += `\n(retryable)`;
  return text;
};

// Format simple success response as plain text
export const formatSuccessText = (message: string): string => {
  return message;
};

// Legacy JSON format (kept for complex responses if needed)
export const toJSON = (data: unknown): string => {
  return JSON.stringify(data);
};

export const mcpResponse = (text: string) => ({
  content: [{ type: "text" as const, text }],
});

