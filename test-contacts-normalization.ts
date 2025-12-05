#!/usr/bin/env tsx
/**
 * Test script for contacts normalization (MCP tools layer)
 * Tests that the flexible input format (strings or typed objects) works correctly
 */

import { createVCardString, parseVCard } from "./src/contacts.js";

// =============================================================================
// Test Helpers
// =============================================================================

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✓ ${message}`);
    testsPassed++;
  } else {
    console.error(`✗ FAIL: ${message}`);
    testsFailed++;
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  if (match) {
    console.log(`✓ ${message}`);
    testsPassed++;
  } else {
    console.error(`✗ FAIL: ${message}`);
    console.error(`  Expected: ${JSON.stringify(expected)}`);
    console.error(`  Actual:   ${JSON.stringify(actual)}`);
    testsFailed++;
  }
}

function testSection(name: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(name);
  console.log("=".repeat(60));
}

// =============================================================================
// Normalization functions (mimicking what MCP tools do)
// =============================================================================

type EmailInput = string | { type?: string; value: string };
type PhoneInput = string | { type?: string; value: string };

const normalizeEmails = (emails?: EmailInput[]): Array<{ type?: string; value: string }> => {
  if (!emails) return [];
  return emails.map((e) => (typeof e === "string" ? { value: e } : e));
};

const normalizePhones = (phones?: PhoneInput[]): Array<{ type?: string; value: string }> => {
  if (!phones) return [];
  return phones.map((p) => (typeof p === "string" ? { value: p } : p));
};

// =============================================================================
// Test 1: Simple string emails
// =============================================================================

testSection("Test 1: Simple string emails");

const emails1: EmailInput[] = ["john@example.com", "jane@work.com"];
const normalized1 = normalizeEmails(emails1);

console.log("Input:", emails1);
console.log("Normalized:", normalized1);

const vcard1 = createVCardString({
  fullName: "Test User",
  emails: normalized1,
});

const parsed1 = parseVCard(vcard1.vCardString, "test://1.vcf");
assertEqual(parsed1?.emails.length, 2, "Should have 2 emails");
assertEqual(parsed1?.emails[0].value, "john@example.com", "Email 1 should match");
assertEqual(parsed1?.emails[1].value, "jane@work.com", "Email 2 should match");

// =============================================================================
// Test 2: Typed object emails
// =============================================================================

testSection("Test 2: Typed object emails");

const emails2: EmailInput[] = [
  { type: "work", value: "bob@company.com" },
  { type: "home", value: "bob@personal.com" },
];
const normalized2 = normalizeEmails(emails2);

console.log("Input:", emails2);
console.log("Normalized:", normalized2);

const vcard2 = createVCardString({
  fullName: "Test User",
  emails: normalized2,
});

const parsed2 = parseVCard(vcard2.vCardString, "test://2.vcf");
assertEqual(parsed2?.emails.length, 2, "Should have 2 emails");
assertEqual(parsed2?.emails[0].type, "work", "Email 1 type should be 'work'");
assertEqual(parsed2?.emails[0].value, "bob@company.com", "Email 1 value should match");
assertEqual(parsed2?.emails[1].type, "home", "Email 2 type should be 'home'");
assertEqual(parsed2?.emails[1].value, "bob@personal.com", "Email 2 value should match");

// =============================================================================
// Test 3: Mixed emails (strings + typed objects)
// =============================================================================

testSection("Test 3: Mixed emails (strings + typed objects)");

const emails3: EmailInput[] = [
  "alice@example.com",
  { type: "work", value: "alice@company.com" },
  "alice@gmail.com",
];
const normalized3 = normalizeEmails(emails3);

console.log("Input:", emails3);
console.log("Normalized:", normalized3);

const vcard3 = createVCardString({
  fullName: "Alice Test",
  emails: normalized3,
});

const parsed3 = parseVCard(vcard3.vCardString, "test://3.vcf");
assertEqual(parsed3?.emails.length, 3, "Should have 3 emails");
assertEqual(parsed3?.emails[0].value, "alice@example.com", "Email 1 should match");
assertEqual(parsed3?.emails[0].type, "other", "Email 1 type should default to 'other'");
assertEqual(parsed3?.emails[1].value, "alice@company.com", "Email 2 should match");
assertEqual(parsed3?.emails[1].type, "work", "Email 2 type should be 'work'");
assertEqual(parsed3?.emails[2].value, "alice@gmail.com", "Email 3 should match");
assertEqual(parsed3?.emails[2].type, "other", "Email 3 type should default to 'other'");

// =============================================================================
// Test 4: Simple string phones
// =============================================================================

testSection("Test 4: Simple string phones");

const phones4: PhoneInput[] = ["+1-555-1234", "+1-555-5678"];
const normalized4 = normalizePhones(phones4);

console.log("Input:", phones4);
console.log("Normalized:", normalized4);

const vcard4 = createVCardString({
  fullName: "Phone Test",
  phones: normalized4,
});

const parsed4 = parseVCard(vcard4.vCardString, "test://4.vcf");
assertEqual(parsed4?.phones.length, 2, "Should have 2 phones");
assertEqual(parsed4?.phones[0].value, "+1-555-1234", "Phone 1 should match");
assertEqual(parsed4?.phones[0].type, "other", "Phone 1 type should default to 'other'");
assertEqual(parsed4?.phones[1].value, "+1-555-5678", "Phone 2 should match");
assertEqual(parsed4?.phones[1].type, "other", "Phone 2 type should default to 'other'");

// =============================================================================
// Test 5: Typed object phones
// =============================================================================

testSection("Test 5: Typed object phones");

const phones5: PhoneInput[] = [
  { type: "cell", value: "+1-555-1111" },
  { type: "work", value: "+1-555-2222" },
  { type: "home", value: "+1-555-3333" },
];
const normalized5 = normalizePhones(phones5);

console.log("Input:", phones5);
console.log("Normalized:", normalized5);

const vcard5 = createVCardString({
  fullName: "Phone Test",
  phones: normalized5,
});

const parsed5 = parseVCard(vcard5.vCardString, "test://5.vcf");
assertEqual(parsed5?.phones.length, 3, "Should have 3 phones");
assertEqual(parsed5?.phones[0].type, "cell", "Phone 1 type should be 'cell'");
assertEqual(parsed5?.phones[1].type, "work", "Phone 2 type should be 'work'");
assertEqual(parsed5?.phones[2].type, "home", "Phone 3 type should be 'home'");

// =============================================================================
// Test 6: Mixed phones (strings + typed objects)
// =============================================================================

testSection("Test 6: Mixed phones (strings + typed objects)");

const phones6: PhoneInput[] = [
  "+1-555-0000",
  { type: "cell", value: "+1-555-1111" },
  "+1-555-2222",
  { type: "work", value: "+1-555-3333" },
];
const normalized6 = normalizePhones(phones6);

console.log("Input:", phones6);
console.log("Normalized:", normalized6);

const vcard6 = createVCardString({
  fullName: "Mixed Phone Test",
  phones: normalized6,
});

const parsed6 = parseVCard(vcard6.vCardString, "test://6.vcf");
assertEqual(parsed6?.phones.length, 4, "Should have 4 phones");
assertEqual(parsed6?.phones[0].value, "+1-555-0000", "Phone 1 should match");
assertEqual(parsed6?.phones[0].type, "other", "Phone 1 type should default to 'other'");
assertEqual(parsed6?.phones[1].value, "+1-555-1111", "Phone 2 should match");
assertEqual(parsed6?.phones[1].type, "cell", "Phone 2 type should be 'cell'");
assertEqual(parsed6?.phones[2].value, "+1-555-2222", "Phone 3 should match");
assertEqual(parsed6?.phones[2].type, "other", "Phone 3 type should default to 'other'");
assertEqual(parsed6?.phones[3].value, "+1-555-3333", "Phone 4 should match");
assertEqual(parsed6?.phones[3].type, "work", "Phone 4 type should be 'work'");

// =============================================================================
// Test 7: Real-world example - creating contact like MCP tool would
// =============================================================================

testSection("Test 7: Real-world MCP-style contact creation");

// Simulating what the MCP create_contact tool receives from Claude
const mcpInput = {
  fullName: "Sarah Connor",
  emails: [
    "sarah@skynet.com",
    { type: "work", value: "s.connor@resistance.org" },
  ] as EmailInput[],
  phones: [
    { type: "cell", value: "+1-310-555-0001" },
    "+1-310-555-0002",
  ] as PhoneInput[],
  organization: "Tech-Com",
  title: "Leader",
};

console.log("MCP Input:", JSON.stringify(mcpInput, null, 2));

const normalizedEmails = normalizeEmails(mcpInput.emails);
const normalizedPhones = normalizePhones(mcpInput.phones);

const vcard7 = createVCardString({
  fullName: mcpInput.fullName,
  emails: normalizedEmails,
  phones: normalizedPhones,
  organization: mcpInput.organization,
  title: mcpInput.title,
});

console.log("\nGenerated vCard:");
console.log(vcard7.vCardString);

const parsed7 = parseVCard(vcard7.vCardString, "test://7.vcf");
assertEqual(parsed7?.fullName, "Sarah Connor", "Name should match");
assertEqual(parsed7?.emails.length, 2, "Should have 2 emails");
assertEqual(parsed7?.emails[0].value, "sarah@skynet.com", "Email 1 should match");
assertEqual(parsed7?.emails[0].type, "other", "Email 1 type should default to 'other'");
assertEqual(parsed7?.emails[1].value, "s.connor@resistance.org", "Email 2 should match");
assertEqual(parsed7?.emails[1].type, "work", "Email 2 type should be 'work'");
assertEqual(parsed7?.phones.length, 2, "Should have 2 phones");
assertEqual(parsed7?.phones[0].value, "+1-310-555-0001", "Phone 1 should match");
assertEqual(parsed7?.phones[0].type, "cell", "Phone 1 type should be 'cell'");
assertEqual(parsed7?.phones[1].value, "+1-310-555-0002", "Phone 2 should match");
assertEqual(parsed7?.phones[1].type, "other", "Phone 2 type should default to 'other'");
assertEqual(parsed7?.organization, "Tech-Com", "Organization should match");
assertEqual(parsed7?.title, "Leader", "Title should match");

// =============================================================================
// Test 8: Empty/undefined arrays
// =============================================================================

testSection("Test 8: Empty/undefined arrays");

const normalized8a = normalizeEmails(undefined);
const normalized8b = normalizeEmails([]);
const normalized8c = normalizePhones(undefined);
const normalized8d = normalizePhones([]);

assertEqual(normalized8a.length, 0, "Undefined emails should normalize to empty array");
assertEqual(normalized8b.length, 0, "Empty emails should normalize to empty array");
assertEqual(normalized8c.length, 0, "Undefined phones should normalize to empty array");
assertEqual(normalized8d.length, 0, "Empty phones should normalize to empty array");

// =============================================================================
// Test Results Summary
// =============================================================================

console.log("\n" + "=".repeat(60));
console.log("TEST RESULTS");
console.log("=".repeat(60));
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);
console.log(`Total:  ${testsPassed + testsFailed}`);

if (testsFailed > 0) {
  console.log("\n❌ Some tests failed!");
  process.exit(1);
} else {
  console.log("\n✅ All tests passed!");
  process.exit(0);
}
