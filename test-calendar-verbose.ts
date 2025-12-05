#!/usr/bin/env tsx
/**
 * Verbose calendar test - shows actual iCal output
 */

import { createICalString, parseICalEvent, type CreateEventParams } from "./src/calendar.js";

console.log("📅 Calendar API - Verbose Output\n");
console.log("=".repeat(80) + "\n");

// Test 1: Simple event
console.log("1️⃣  SIMPLE ONE-TIME EVENT");
console.log("-".repeat(80));
const { icalString: ical1, uid: uid1 } = createICalString({
  summary: "Team Meeting",
  start: new Date("2025-12-15T10:00:00Z"),
  end: new Date("2025-12-15T11:00:00Z"),
  location: "Conference Room A",
  description: "Weekly team sync",
});
console.log(ical1);
console.log("\nParsed back:");
console.log(JSON.stringify(parseICalEvent(ical1, "test-url"), null, 2));
console.log("\n" + "=".repeat(80) + "\n");

// Test 2: All-day event
console.log("2️⃣  ALL-DAY EVENT");
console.log("-".repeat(80));
const { icalString: ical2 } = createICalString({
  summary: "Christmas Day",
  start: new Date("2025-12-25T00:00:00Z"),
  end: new Date("2025-12-26T00:00:00Z"),
  allDay: true,
  description: "Holiday",
});
console.log(ical2);
console.log("\nParsed back:");
console.log(JSON.stringify(parseICalEvent(ical2, "test-url"), null, 2));
console.log("\n" + "=".repeat(80) + "\n");

// Test 3: Weekly recurring (Mon, Wed, Fri)
console.log("3️⃣  RECURRING WEEKLY (Mon, Wed, Fri)");
console.log("-".repeat(80));
const { icalString: ical3 } = createICalString({
  summary: "Morning Standup",
  start: new Date("2025-12-15T09:00:00Z"),
  end: new Date("2025-12-15T10:00:00Z"),
  recurrence: {
    frequency: "weekly",
    byDay: ["MO", "WE", "FR"],
  },
});
console.log(ical3);
console.log("\nParsed back:");
console.log(JSON.stringify(parseICalEvent(ical3, "test-url"), null, 2));
console.log("\n" + "=".repeat(80) + "\n");

// Test 4: Daily with count
console.log("4️⃣  RECURRING DAILY (5 times)");
console.log("-".repeat(80));
const { icalString: ical4 } = createICalString({
  summary: "Training Session",
  start: new Date("2025-12-16T14:00:00Z"),
  end: new Date("2025-12-16T15:00:00Z"),
  description: "5-day training program",
  recurrence: {
    frequency: "daily",
    count: 5,
  },
});
console.log(ical4);
console.log("\nParsed back:");
console.log(JSON.stringify(parseICalEvent(ical4, "test-url"), null, 2));
console.log("\n" + "=".repeat(80) + "\n");

// Test 5: Complex recurrence
console.log("5️⃣  COMPLEX RECURRENCE (Mon/Thu, 10 times)");
console.log("-".repeat(80));
const { icalString: ical5 } = createICalString({
  summary: "Team Workout",
  start: new Date("2025-12-15T08:00:00Z"),
  end: new Date("2025-12-15T09:00:00Z"),
  location: "Gym",
  recurrence: {
    frequency: "weekly",
    byDay: ["MO", "TH"],
    count: 10,
  },
});
console.log(ical5);
console.log("\nParsed back:");
const parsed5 = parseICalEvent(ical5, "test-url");
console.log(JSON.stringify(parsed5, null, 2));
console.log("\nHuman-readable recurrence: " + parsed5?.recurrence?.humanReadable);
console.log("\n" + "=".repeat(80));
