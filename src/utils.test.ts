import { expect, test } from "vitest";
import { toCSV, toRFC5322 } from "./utils.js";

// =============================================================================
// CSV Escaping Torture Tests
// =============================================================================

test("CSV escaping - comma in value", () => {
  const rows = [{ id: "1", name: "Smith, John" }];
  const result = toCSV(rows, ["id", "name"]);
  expect(result).toBe('id,name\n1,"Smith, John"');
});

test("CSV escaping - quote in value", () => {
  const rows = [{ id: "1", name: 'Say "hello"' }];
  const result = toCSV(rows, ["id", "name"]);
  expect(result).toBe('id,name\n1,"Say ""hello"""');
});

test("CSV escaping - newline in value", () => {
  const rows = [{ id: "1", name: "Line 1\nLine 2" }];
  const result = toCSV(rows, ["id", "name"]);
  expect(result).toBe('id,name\n1,"Line 1\nLine 2"');
});

test("CSV escaping - comma, quote, and newline", () => {
  const rows = [{ id: "1", msg: 'Hello, "World"\nHow are you?' }];
  const result = toCSV(rows, ["id", "msg"]);
  expect(result).toBe('id,msg\n1,"Hello, ""World""\nHow are you?"');
});

test("CSV escaping - multiple consecutive quotes", () => {
  const rows = [{ id: "1", name: '"""quoted"""' }];
  const result = toCSV(rows, ["id", "name"]);
  expect(result).toBe('id,name\n1,"""""""quoted"""""""');
});

test("CSV escaping - empty string", () => {
  const rows = [{ id: "1", name: "" }];
  const result = toCSV(rows, ["id", "name"]);
  expect(result).toBe("id,name\n1,");
});

test("CSV escaping - null value", () => {
  const rows = [{ id: "1", name: null }];
  const result = toCSV(rows, ["id", "name"]);
  expect(result).toBe("id,name\n1,");
});

test("CSV escaping - undefined value", () => {
  const rows = [{ id: "1", name: undefined }];
  const result = toCSV(rows, ["id", "name"]);
  expect(result).toBe("id,name\n1,");
});

test("CSV escaping - array value (flags)", () => {
  const rows = [{ id: "1", flags: ["read", "flagged"] }];
  const result = toCSV(rows, ["id", "flags"]);
  expect(result).toBe("id,flags\n1,read;flagged");
});

test("CSV escaping - array with comma-containing values", () => {
  const rows = [{ id: "1", tags: ["foo, bar", "baz"] }];
  const result = toCSV(rows, ["id", "tags"]);
  expect(result).toBe('id,tags\n1,"foo, bar;baz"');
});

test("CSV escaping - no special chars (no quotes added)", () => {
  const rows = [{ id: "1", name: "JohnSmith" }];
  const result = toCSV(rows, ["id", "name"]);
  expect(result).toBe("id,name\n1,JohnSmith");
});

test("CSV with metadata", () => {
  const rows = [{ id: "1", name: "John" }];
  const result = toCSV(rows, ["id", "name"], { total: 100, has_more: true });
  expect(result).toBe("id,name\n1,John\n# total=100 has_more=true");
});

test("CSV empty results", () => {
  const result = toCSV([], ["id", "name"]);
  expect(result).toBe("id,name\n(no results)");
});

test("CSV empty results with metadata", () => {
  const result = toCSV([], ["id", "name"], { total: 0 });
  expect(result).toBe("id,name\n(no results)");
});

// =============================================================================
// RFC 5322 Header Sanitization Torture Tests
// =============================================================================

test("RFC 5322 - subject with newline", () => {
  const email = {
    id: "test1",
    thread_id: "t1",
    subject: "Hello\nWorld",
    from: "test@example.com",
    to: ["user@example.com"],
    date: "2024-01-15T10:00:00Z",
    flags: [],
    body: "Body text",
  };
  const result = toRFC5322(email);
  expect(result.includes("Subject: Hello World")).toBe(true);
  expect(result.includes("Subject: Hello\nWorld")).toBe(false);
});

test("RFC 5322 - subject with CRLF", () => {
  const email = {
    id: "test1",
    thread_id: "t1",
    subject: "Hello\r\nWorld",
    from: "test@example.com",
    to: ["user@example.com"],
    date: "2024-01-15T10:00:00Z",
    flags: [],
    body: "Body text",
  };
  const result = toRFC5322(email);
  expect(result.includes("Subject: Hello World")).toBe(true);
});

test("RFC 5322 - subject with tab", () => {
  const email = {
    id: "test1",
    thread_id: "t1",
    subject: "Hello\tWorld",
    from: "test@example.com",
    to: ["user@example.com"],
    date: "2024-01-15T10:00:00Z",
    flags: [],
    body: "Body text",
  };
  const result = toRFC5322(email);
  expect(result.includes("Subject: Hello World")).toBe(true);
});

test("RFC 5322 - subject with multiple newlines", () => {
  const email = {
    id: "test1",
    thread_id: "t1",
    subject: "Line1\n\n\nLine2",
    from: "test@example.com",
    to: ["user@example.com"],
    date: "2024-01-15T10:00:00Z",
    flags: [],
    body: "Body text",
  };
  const result = toRFC5322(email);
  expect(result.includes("Subject: Line1 Line2")).toBe(true);
});

test("RFC 5322 - from with newline", () => {
  const email = {
    id: "test1",
    thread_id: "t1",
    subject: "Test",
    from: "Evil\nUser <evil@example.com>",
    to: ["user@example.com"],
    date: "2024-01-15T10:00:00Z",
    flags: [],
    body: "Body text",
  };
  const result = toRFC5322(email);
  expect(result.includes("From: Evil User <evil@example.com>")).toBe(true);
  // Ensure no actual newline in From header
  const fromLine = result.split("\n").find((l) => l.startsWith("From:"));
  expect(fromLine?.includes("\n")).toBe(false);
});

test("RFC 5322 - to addresses with newlines", () => {
  const email = {
    id: "test1",
    thread_id: "t1",
    subject: "Test",
    from: "test@example.com",
    to: ["user1\n@example.com", "user2@example.com"],
    date: "2024-01-15T10:00:00Z",
    flags: [],
    body: "Body text",
  };
  const result = toRFC5322(email);
  expect(result.includes("To: user1 @example.com, user2@example.com")).toBe(true);
});

test("RFC 5322 - list-unsubscribe with newline injection attempt", () => {
  const email = {
    id: "test1",
    thread_id: "t1",
    subject: "Test",
    from: "test@example.com",
    to: ["user@example.com"],
    date: "2024-01-15T10:00:00Z",
    flags: [],
    headers: {
      list_unsubscribe: "<mailto:unsub@example.com>\nX-Injected: malicious",
    },
    body: "Body text",
  };
  const result = toRFC5322(email);
  expect(
    result.includes("List-Unsubscribe: <mailto:unsub@example.com> X-Injected: malicious"),
    true,
  );
  // Ensure it's on one line
  const lines = result.split("\n");
  const unsubLine = lines.find((l) => l.startsWith("List-Unsubscribe:"));
  expect(unsubLine?.includes("\n")).toBe(false);
});

test("RFC 5322 - attachment name with newline", () => {
  const email = {
    id: "test1",
    thread_id: "t1",
    subject: "Test",
    from: "test@example.com",
    to: ["user@example.com"],
    date: "2024-01-15T10:00:00Z",
    flags: [],
    body: "Body text",
    attachments: [
      { name: "file\nname.pdf", type: "application/pdf", size: 1024 },
    ],
  };
  const result = toRFC5322(email);
  expect(result.includes("X-Attachments: file name.pdf (application/pdf, 1024 bytes)")).toBe(true);
});

test("RFC 5322 - header with only whitespace", () => {
  const email = {
    id: "test1",
    thread_id: "t1",
    subject: "  \n\t  ",
    from: "test@example.com",
    to: ["user@example.com"],
    date: "2024-01-15T10:00:00Z",
    flags: [],
    body: "Body text",
  };
  const result = toRFC5322(email);
  // Should collapse to empty or minimal whitespace
  expect(result.includes("Subject: ")).toBe(true);
  expect(result.includes("Subject:  \n\t  ")).toBe(false);
});

test("RFC 5322 - body is NOT escaped (appears after blank line)", () => {
  const email = {
    id: "test1",
    thread_id: "t1",
    subject: "Test",
    from: "test@example.com",
    to: ["user@example.com"],
    date: "2024-01-15T10:00:00Z",
    flags: [],
    body: "Line 1\nLine 2\nLine 3",
  };
  const result = toRFC5322(email);
  // Body should preserve newlines
  expect(result.includes("\n\nLine 1\nLine 2\nLine 3")).toBe(true);
});

test("RFC 5322 - complete structure with all fields", () => {
  const email = {
    id: "abc123",
    thread_id: "thread456",
    message_id: "<msg@example.com>",
    subject: "Test Subject",
    from: "Sender <sender@example.com>",
    to: ["Recipient <recipient@example.com>"],
    cc: ["CC User <cc@example.com>"],
    reply_to: ["Reply <reply@example.com>"],
    date: "2024-01-15T10:00:00Z",
    flags: ["read", "flagged"],
    headers: {
      list_unsubscribe: "<mailto:unsub@example.com>",
      list_id: "<list.example.com>",
    },
    body: "Email body content",
    body_truncated: false,
    body_source: "text" as const,
    cache_path: "/tmp/cache",
    attachments: [
      { name: "file.pdf", type: "application/pdf", size: 1024 },
    ],
  };
  const result = toRFC5322(email);

  // Verify structure: headers, blank line, body
  const lines = result.split("\n");
  const blankLineIndex = lines.findIndex((l) => l === "");
  expect(blankLineIndex > 0).toBe(true); // Should have headers before blank line
  expect(lines[blankLineIndex + 1]).toBe("Email body content");

  // Verify key headers present
  expect(result.includes("Message-ID: <msg@example.com>")).toBe(true);
  expect(result.includes("X-JMAP-Id: abc123")).toBe(true);
  expect(result.includes("Subject: Test Subject")).toBe(true);
  expect(result.includes("From: Sender <sender@example.com>")).toBe(true);
  expect(result.includes("X-Flags: read, flagged")).toBe(true);
});
