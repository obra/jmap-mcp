#!/usr/bin/env tsx
/**
 * Test script for contacts API
 * Tests vCard creation, parsing, and updating functionality
 */

import { createVCardString, parseVCard, updateVCardString } from "./src/contacts.js";

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
// Test 1: Simple contact with just a name
// =============================================================================

testSection("Test 1: Simple contact with just a name");

const test1 = createVCardString({
  fullName: "John Doe",
});

console.log("\nGenerated vCard:");
console.log(test1.vCardString);

assert(test1.uid.length > 0, "UID should be generated");
assert(test1.vCardString.includes("BEGIN:VCARD"), "Should contain BEGIN:VCARD");
assert(test1.vCardString.includes("END:VCARD"), "Should contain END:VCARD");
assert(test1.vCardString.includes("FN:John Doe"), "Should contain full name");
assert(test1.vCardString.includes("VERSION:3.0"), "Should be vCard 3.0");

const parsed1 = parseVCard(test1.vCardString, "test://contact1.vcf");
assert(parsed1 !== undefined, "Should parse successfully");
assert(parsed1?.fullName === "John Doe", "Parsed name should match");
assert(parsed1?.emails.length === 0, "Should have no emails");
assert(parsed1?.phones.length === 0, "Should have no phones");

// =============================================================================
// Test 2: Contact with name + simple string email
// =============================================================================

testSection("Test 2: Contact with name + simple string email");

const test2 = createVCardString({
  fullName: "Jane Smith",
  emails: [{ value: "jane@example.com" }],
});

console.log("\nGenerated vCard:");
console.log(test2.vCardString);

assert(test2.vCardString.includes("EMAIL:jane@example.com"), "Should contain email");

const parsed2 = parseVCard(test2.vCardString, "test://contact2.vcf");
assert(parsed2 !== undefined, "Should parse successfully");
assertEqual(parsed2?.fullName, "Jane Smith", "Name should match");
assertEqual(parsed2?.emails.length, 1, "Should have 1 email");
assertEqual(parsed2?.emails[0].value, "jane@example.com", "Email value should match");
// Note: type defaults to "other" when not specified
assertEqual(parsed2?.emails[0].type, "other", "Email type should default to 'other'");

// =============================================================================
// Test 3: Contact with typed email
// =============================================================================

testSection("Test 3: Contact with typed email");

const test3 = createVCardString({
  fullName: "Bob Johnson",
  emails: [{ type: "work", value: "bob@work.com" }],
});

console.log("\nGenerated vCard:");
console.log(test3.vCardString);

assert(test3.vCardString.includes("TYPE=WORK"), "Should contain WORK type");
assert(test3.vCardString.includes("bob@work.com"), "Should contain email");

const parsed3 = parseVCard(test3.vCardString, "test://contact3.vcf");
assert(parsed3 !== undefined, "Should parse successfully");
assertEqual(parsed3?.emails[0].type, "work", "Email type should be 'work'");
assertEqual(parsed3?.emails[0].value, "bob@work.com", "Email value should match");

// =============================================================================
// Test 4: Contact with multiple mixed phones
// =============================================================================

testSection("Test 4: Contact with multiple mixed phones");

const test4 = createVCardString({
  fullName: "Alice Williams",
  phones: [
    { value: "+1-555-1234" },
    { type: "cell", value: "+1-555-5678" },
    { type: "work", value: "+1-555-9999" },
  ],
});

console.log("\nGenerated vCard:");
console.log(test4.vCardString);

assert(test4.vCardString.includes("+1-555-1234"), "Should contain phone 1");
assert(test4.vCardString.includes("+1-555-5678"), "Should contain phone 2");
assert(test4.vCardString.includes("+1-555-9999"), "Should contain phone 3");

const parsed4 = parseVCard(test4.vCardString, "test://contact4.vcf");
assert(parsed4 !== undefined, "Should parse successfully");
assertEqual(parsed4?.phones.length, 3, "Should have 3 phones");
assertEqual(parsed4?.phones[0].value, "+1-555-1234", "Phone 1 value should match");
assertEqual(parsed4?.phones[0].type, "other", "Phone 1 type should default to 'other'");
assertEqual(parsed4?.phones[1].value, "+1-555-5678", "Phone 2 value should match");
assertEqual(parsed4?.phones[1].type, "cell", "Phone 2 type should be 'cell'");
assertEqual(parsed4?.phones[2].value, "+1-555-9999", "Phone 3 value should match");
assertEqual(parsed4?.phones[2].type, "work", "Phone 3 type should be 'work'");

// =============================================================================
// Test 5: Contact with organization and title
// =============================================================================

testSection("Test 5: Contact with organization and title");

const test5 = createVCardString({
  fullName: "Charlie Brown",
  organization: "Acme Corp",
  title: "Senior Engineer",
  emails: [{ type: "work", value: "charlie@acme.com" }],
});

console.log("\nGenerated vCard:");
console.log(test5.vCardString);

assert(test5.vCardString.includes("ORG:Acme Corp"), "Should contain organization");
assert(test5.vCardString.includes("TITLE:Senior Engineer"), "Should contain title");

const parsed5 = parseVCard(test5.vCardString, "test://contact5.vcf");
assert(parsed5 !== undefined, "Should parse successfully");
assertEqual(parsed5?.organization, "Acme Corp", "Organization should match");
assertEqual(parsed5?.title, "Senior Engineer", "Title should match");
assertEqual(parsed5?.emails[0].value, "charlie@acme.com", "Email should match");

// =============================================================================
// Test 6: Contact with notes
// =============================================================================

testSection("Test 6: Contact with notes");

const test6 = createVCardString({
  fullName: "Diana Prince",
  notes: "Met at conference 2024",
});

console.log("\nGenerated vCard:");
console.log(test6.vCardString);

assert(test6.vCardString.includes("NOTE:Met at conference 2024"), "Should contain notes");

const parsed6 = parseVCard(test6.vCardString, "test://contact6.vcf");
assert(parsed6 !== undefined, "Should parse successfully");
assertEqual(parsed6?.notes, "Met at conference 2024", "Notes should match");

// =============================================================================
// Test 7: Update existing vCard - change name
// =============================================================================

testSection("Test 7: Update existing vCard - change name");

const updated7 = updateVCardString(test1.vCardString, {
  fullName: "John David Doe",
});

console.log("\nUpdated vCard:");
console.log(updated7);

assert(updated7.includes("FN:John David Doe"), "Should have updated name");

const parsed7 = parseVCard(updated7, "test://contact7.vcf");
assertEqual(parsed7?.fullName, "John David Doe", "Updated name should match");
assertEqual(parsed7?.uid, test1.uid, "UID should be preserved");

// =============================================================================
// Test 8: Update existing vCard - add emails
// =============================================================================

testSection("Test 8: Update existing vCard - add emails");

const updated8 = updateVCardString(test1.vCardString, {
  emails: [
    { type: "work", value: "john@work.com" },
    { value: "john@personal.com" },
  ],
});

console.log("\nUpdated vCard:");
console.log(updated8);

const parsed8 = parseVCard(updated8, "test://contact8.vcf");
assertEqual(parsed8?.emails.length, 2, "Should have 2 emails");
assertEqual(parsed8?.emails[0].value, "john@work.com", "Email 1 should match");
assertEqual(parsed8?.emails[0].type, "work", "Email 1 type should be 'work'");
assertEqual(parsed8?.emails[1].value, "john@personal.com", "Email 2 should match");
assertEqual(parsed8?.emails[1].type, "other", "Email 2 type should default to 'other'");

// =============================================================================
// Test 9: Update existing vCard - clear organization
// =============================================================================

testSection("Test 9: Update existing vCard - clear organization");

const updated9 = updateVCardString(test5.vCardString, {
  organization: "",
});

console.log("\nUpdated vCard:");
console.log(updated9);

assert(!updated9.includes("ORG:"), "Should not contain ORG field");

const parsed9 = parseVCard(updated9, "test://contact9.vcf");
assertEqual(parsed9?.organization, undefined, "Organization should be undefined");
assertEqual(parsed9?.title, "Senior Engineer", "Title should be preserved");

// =============================================================================
// Test 10: Update existing vCard - clear emails
// =============================================================================

testSection("Test 10: Update existing vCard - clear emails");

const updated10 = updateVCardString(test3.vCardString, {
  emails: [],
});

console.log("\nUpdated vCard:");
console.log(updated10);

const parsed10 = parseVCard(updated10, "test://contact10.vcf");
assertEqual(parsed10?.emails.length, 0, "Should have no emails");
assertEqual(parsed10?.fullName, "Bob Johnson", "Name should be preserved");

// =============================================================================
// Test 11: Update existing vCard - replace phones
// =============================================================================

testSection("Test 11: Update existing vCard - replace phones");

const updated11 = updateVCardString(test4.vCardString, {
  phones: [
    { type: "home", value: "+1-555-0000" },
  ],
});

console.log("\nUpdated vCard:");
console.log(updated11);

const parsed11 = parseVCard(updated11, "test://contact11.vcf");
assertEqual(parsed11?.phones.length, 1, "Should have 1 phone");
assertEqual(parsed11?.phones[0].value, "+1-555-0000", "Phone should match");
assertEqual(parsed11?.phones[0].type, "home", "Phone type should be 'home'");

// =============================================================================
// Test 12: Parse invalid vCard
// =============================================================================

testSection("Test 12: Parse invalid vCard");

const invalidVCard = "This is not a vCard";
const parsedInvalid = parseVCard(invalidVCard, "test://invalid.vcf");
assertEqual(parsedInvalid, undefined, "Should return undefined for invalid vCard");

// =============================================================================
// Test 13: Parse vCard missing required fields
// =============================================================================

testSection("Test 13: Parse vCard missing required fields");

const missingFN = `BEGIN:VCARD
VERSION:3.0
UID:test-uid
END:VCARD`;

const parsedMissingFN = parseVCard(missingFN, "test://missing.vcf");
assertEqual(parsedMissingFN, undefined, "Should return undefined when FN is missing");

// =============================================================================
// Test 14: Complex contact with all fields
// =============================================================================

testSection("Test 14: Complex contact with all fields");

const test14 = createVCardString({
  fullName: "Eve Anderson",
  emails: [
    { type: "work", value: "eve@company.com" },
    { type: "home", value: "eve@personal.com" },
  ],
  phones: [
    { type: "cell", value: "+1-555-1111" },
    { type: "work", value: "+1-555-2222" },
    { type: "home", value: "+1-555-3333" },
  ],
  organization: "Tech Innovations Inc",
  title: "CTO",
  notes: "Key contact for project collaboration",
});

console.log("\nGenerated vCard:");
console.log(test14.vCardString);

const parsed14 = parseVCard(test14.vCardString, "test://contact14.vcf");
assert(parsed14 !== undefined, "Should parse successfully");
assertEqual(parsed14?.fullName, "Eve Anderson", "Name should match");
assertEqual(parsed14?.emails.length, 2, "Should have 2 emails");
assertEqual(parsed14?.phones.length, 3, "Should have 3 phones");
assertEqual(parsed14?.organization, "Tech Innovations Inc", "Organization should match");
assertEqual(parsed14?.title, "CTO", "Title should match");
assertEqual(parsed14?.notes, "Key contact for project collaboration", "Notes should match");

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
