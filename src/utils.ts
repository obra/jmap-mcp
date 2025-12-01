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

export const toJSON = (data: unknown): string => {
  return JSON.stringify(data, null, 2);
};

export const mcpResponse = (data: unknown) => ({
  content: [{ type: "text" as const, text: toJSON(data) }],
});
