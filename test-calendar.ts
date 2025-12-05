#!/usr/bin/env tsx
/**
 * Calendar API test script
 * Tests createICalString and parseICalEvent with various scenarios
 */

import {
  createICalString,
  parseICalEvent,
  type CreateEventParams,
  type CalendarEvent,
} from "./src/calendar.js";

// =============================================================================
// Test Utilities
// =============================================================================

let testCount = 0;
let passCount = 0;
let failCount = 0;

const test = (name: string, fn: () => void) => {
  testCount++;
  try {
    fn();
    passCount++;
    console.log(`✅ ${name}`);
  } catch (error) {
    failCount++;
    console.log(`❌ ${name}`);
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const assertEqual = <T>(actual: T, expected: T, message?: string) => {
  if (actual !== expected) {
    throw new Error(
      message || `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`
    );
  }
};

const assertArrayEqual = <T>(actual: T[] | undefined, expected: T[], message?: string) => {
  if (!actual) {
    throw new Error(message || `Expected array but got undefined`);
  }
  if (actual.length !== expected.length) {
    throw new Error(
      message ||
        `Array length mismatch: expected ${expected.length} but got ${actual.length}`
    );
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        message ||
          `Array element ${i} mismatch: expected ${JSON.stringify(expected[i])} but got ${JSON.stringify(actual[i])}`
      );
    }
  }
};

const assertDatesEqual = (actual: Date | undefined, expected: Date, message?: string) => {
  if (!actual) {
    throw new Error(message || `Expected date but got undefined`);
  }
  // Compare timestamps (to nearest second to avoid millisecond rounding issues)
  const actualTime = Math.floor(actual.getTime() / 1000);
  const expectedTime = Math.floor(expected.getTime() / 1000);
  if (actualTime !== expectedTime) {
    throw new Error(
      message ||
        `Date mismatch: expected ${expected.toISOString()} but got ${actual.toISOString()}`
    );
  }
};

const assertContains = (actual: string, expected: string, message?: string) => {
  if (!actual.includes(expected)) {
    throw new Error(
      message || `Expected string to contain "${expected}" but got "${actual}"`
    );
  }
};

// =============================================================================
// Test Cases
// =============================================================================

console.log("🧪 Testing Calendar API\n");

// Test 1: Simple one-time event
test("Simple one-time event", () => {
  const start = new Date("2025-12-15T10:00:00Z");
  const end = new Date("2025-12-15T11:00:00Z");

  const params: CreateEventParams = {
    summary: "Team Meeting",
    start,
    end,
    location: "Conference Room A",
    description: "Weekly team sync",
  };

  const { icalString, uid } = createICalString(params);

  // Verify iCal string structure
  assertContains(icalString, "BEGIN:VCALENDAR");
  assertContains(icalString, "BEGIN:VEVENT");
  assertContains(icalString, "SUMMARY:Team Meeting");
  assertContains(icalString, "LOCATION:Conference Room A");
  assertContains(icalString, "DESCRIPTION:Weekly team sync");
  assertContains(icalString, `UID:${uid}`);

  // Parse it back
  const parsed = parseICalEvent(icalString, "test-url");
  if (!parsed) {
    throw new Error("Failed to parse generated iCal");
  }

  assertEqual(parsed.summary, "Team Meeting");
  assertEqual(parsed.location, "Conference Room A");
  assertEqual(parsed.description, "Weekly team sync");
  assertEqual(parsed.allDay, false);
  assertDatesEqual(parsed.start, start);
  assertDatesEqual(parsed.end, end);
  assertEqual(parsed.recurrence, undefined);
});

// Test 2: All-day event
test("All-day event", () => {
  const start = new Date("2025-12-25T00:00:00Z");
  const end = new Date("2025-12-26T00:00:00Z");

  const params: CreateEventParams = {
    summary: "Christmas Day",
    start,
    end,
    allDay: true,
    description: "Holiday",
  };

  const { icalString } = createICalString(params);

  // Verify it's marked as DATE not DATE-TIME
  assertContains(icalString, "DTSTART;VALUE=DATE:");
  assertContains(icalString, "DTEND;VALUE=DATE:");

  // Parse it back
  const parsed = parseICalEvent(icalString, "test-url");
  if (!parsed) {
    throw new Error("Failed to parse generated iCal");
  }

  assertEqual(parsed.summary, "Christmas Day");
  assertEqual(parsed.allDay, true);
  assertEqual(parsed.description, "Holiday");
  // All-day events should still have valid dates
  if (!parsed.start || !parsed.end) {
    throw new Error("All-day event missing start or end date");
  }
});

// Test 3: Recurring weekly event (Mon, Wed, Fri)
test("Recurring weekly event (Mon, Wed, Fri)", () => {
  const start = new Date("2025-12-15T09:00:00Z");
  const end = new Date("2025-12-15T10:00:00Z");

  const params: CreateEventParams = {
    summary: "Morning Standup",
    start,
    end,
    recurrence: {
      frequency: "weekly",
      byDay: ["MO", "WE", "FR"],
    },
  };

  const { icalString } = createICalString(params);

  // Verify RRULE is present
  assertContains(icalString, "RRULE:");
  assertContains(icalString, "FREQ=WEEKLY");
  assertContains(icalString, "BYDAY=MO,WE,FR");

  // Parse it back
  const parsed = parseICalEvent(icalString, "test-url");
  if (!parsed) {
    throw new Error("Failed to parse generated iCal");
  }

  assertEqual(parsed.summary, "Morning Standup");
  assertDatesEqual(parsed.start, start);
  assertDatesEqual(parsed.end, end);

  // Verify recurrence info
  if (!parsed.recurrence) {
    throw new Error("Recurrence info missing");
  }
  assertEqual(parsed.recurrence.frequency, "WEEKLY");
  assertArrayEqual(parsed.recurrence.byDay, ["MO", "WE", "FR"]);
  assertEqual(parsed.recurrence.interval, undefined); // Default interval is 1, not stored
  assertEqual(parsed.recurrence.count, undefined);
  assertEqual(parsed.recurrence.until, undefined);

  // Verify human-readable format
  assertContains(parsed.recurrence.humanReadable, "weekly");
  assertContains(parsed.recurrence.humanReadable, "Monday");
  assertContains(parsed.recurrence.humanReadable, "Wednesday");
  assertContains(parsed.recurrence.humanReadable, "Friday");
});

// Test 4: Recurring daily event with count=5
test("Recurring daily event with count=5", () => {
  const start = new Date("2025-12-16T14:00:00Z");
  const end = new Date("2025-12-16T15:00:00Z");

  const params: CreateEventParams = {
    summary: "Training Session",
    start,
    end,
    description: "5-day training program",
    recurrence: {
      frequency: "daily",
      count: 5,
    },
  };

  const { icalString } = createICalString(params);

  // Verify RRULE with COUNT
  assertContains(icalString, "RRULE:");
  assertContains(icalString, "FREQ=DAILY");
  assertContains(icalString, "COUNT=5");

  // Parse it back
  const parsed = parseICalEvent(icalString, "test-url");
  if (!parsed) {
    throw new Error("Failed to parse generated iCal");
  }

  assertEqual(parsed.summary, "Training Session");
  assertEqual(parsed.description, "5-day training program");
  assertDatesEqual(parsed.start, start);
  assertDatesEqual(parsed.end, end);

  // Verify recurrence info
  if (!parsed.recurrence) {
    throw new Error("Recurrence info missing");
  }
  assertEqual(parsed.recurrence.frequency, "DAILY");
  assertEqual(parsed.recurrence.count, 5);
  assertEqual(parsed.recurrence.until, undefined);
  assertEqual(parsed.recurrence.byDay, undefined);

  // Verify human-readable format
  assertContains(parsed.recurrence.humanReadable, "daily");
  assertContains(parsed.recurrence.humanReadable, "5 times");
});

// Test 5: Recurring event with UNTIL date
test("Recurring monthly event with UNTIL date", () => {
  const start = new Date("2025-12-01T10:00:00Z");
  const end = new Date("2025-12-01T11:00:00Z");
  const until = new Date("2026-06-01T00:00:00Z");

  const params: CreateEventParams = {
    summary: "Monthly Review",
    start,
    end,
    recurrence: {
      frequency: "monthly",
      until,
    },
  };

  const { icalString } = createICalString(params);

  // Verify RRULE with UNTIL
  assertContains(icalString, "RRULE:");
  assertContains(icalString, "FREQ=MONTHLY");
  assertContains(icalString, "UNTIL=");

  // Parse it back
  const parsed = parseICalEvent(icalString, "test-url");
  if (!parsed) {
    throw new Error("Failed to parse generated iCal");
  }

  assertEqual(parsed.summary, "Monthly Review");

  // Verify recurrence info
  if (!parsed.recurrence) {
    throw new Error("Recurrence info missing");
  }
  assertEqual(parsed.recurrence.frequency, "MONTHLY");
  assertEqual(parsed.recurrence.count, undefined);
  assertDatesEqual(parsed.recurrence.until, until);

  // Verify human-readable format
  assertContains(parsed.recurrence.humanReadable, "monthly");
  assertContains(parsed.recurrence.humanReadable, "until");
});

// Test 6: Recurring event with interval
test("Recurring event every 2 weeks", () => {
  const start = new Date("2025-12-15T14:00:00Z");
  const end = new Date("2025-12-15T15:00:00Z");

  const params: CreateEventParams = {
    summary: "Bi-weekly Sprint Planning",
    start,
    end,
    recurrence: {
      frequency: "weekly",
      interval: 2,
    },
  };

  const { icalString } = createICalString(params);

  // Verify RRULE with INTERVAL
  assertContains(icalString, "RRULE:");
  assertContains(icalString, "FREQ=WEEKLY");
  assertContains(icalString, "INTERVAL=2");

  // Parse it back
  const parsed = parseICalEvent(icalString, "test-url");
  if (!parsed) {
    throw new Error("Failed to parse generated iCal");
  }

  assertEqual(parsed.summary, "Bi-weekly Sprint Planning");

  // Verify recurrence info
  if (!parsed.recurrence) {
    throw new Error("Recurrence info missing");
  }
  assertEqual(parsed.recurrence.frequency, "WEEKLY");
  assertEqual(parsed.recurrence.interval, 2);

  // Verify human-readable format
  assertContains(parsed.recurrence.humanReadable, "every 2");
});

// Test 7: Event without end time
test("Event without end time", () => {
  const start = new Date("2025-12-20T15:00:00Z");

  const params: CreateEventParams = {
    summary: "Quick Check-in",
    start,
  };

  const { icalString } = createICalString(params);

  assertContains(icalString, "SUMMARY:Quick Check-in");

  // Parse it back
  const parsed = parseICalEvent(icalString, "test-url");
  if (!parsed) {
    throw new Error("Failed to parse generated iCal");
  }

  assertEqual(parsed.summary, "Quick Check-in");
  assertDatesEqual(parsed.start, start);
  // End time should be undefined or equal to start
  if (parsed.end !== undefined) {
    // Some calendar systems auto-generate end = start for events without end
    assertDatesEqual(parsed.end, start);
  }
});

// Test 8: Complex recurrence (weekly on multiple days with count)
test("Complex recurrence: weekly on Mon/Thu for 10 occurrences", () => {
  const start = new Date("2025-12-15T08:00:00Z");
  const end = new Date("2025-12-15T09:00:00Z");

  const params: CreateEventParams = {
    summary: "Team Workout",
    start,
    end,
    location: "Gym",
    recurrence: {
      frequency: "weekly",
      byDay: ["MO", "TH"],
      count: 10,
    },
  };

  const { icalString } = createICalString(params);

  assertContains(icalString, "RRULE:");
  assertContains(icalString, "FREQ=WEEKLY");
  assertContains(icalString, "BYDAY=MO,TH");
  assertContains(icalString, "COUNT=10");

  // Parse it back
  const parsed = parseICalEvent(icalString, "test-url");
  if (!parsed) {
    throw new Error("Failed to parse generated iCal");
  }

  assertEqual(parsed.summary, "Team Workout");
  assertEqual(parsed.location, "Gym");

  // Verify recurrence info
  if (!parsed.recurrence) {
    throw new Error("Recurrence info missing");
  }
  assertEqual(parsed.recurrence.frequency, "WEEKLY");
  assertArrayEqual(parsed.recurrence.byDay, ["MO", "TH"]);
  assertEqual(parsed.recurrence.count, 10);

  // Verify human-readable format
  assertContains(parsed.recurrence.humanReadable, "weekly");
  assertContains(parsed.recurrence.humanReadable, "Monday");
  assertContains(parsed.recurrence.humanReadable, "Thursday");
  assertContains(parsed.recurrence.humanReadable, "10 times");
});

// Test 9: Yearly recurrence
test("Yearly recurring event", () => {
  const start = new Date("2025-12-25T00:00:00Z");

  const params: CreateEventParams = {
    summary: "Birthday",
    start,
    allDay: true,
    recurrence: {
      frequency: "yearly",
    },
  };

  const { icalString } = createICalString(params);

  assertContains(icalString, "RRULE:");
  assertContains(icalString, "FREQ=YEARLY");

  // Parse it back
  const parsed = parseICalEvent(icalString, "test-url");
  if (!parsed) {
    throw new Error("Failed to parse generated iCal");
  }

  assertEqual(parsed.summary, "Birthday");
  assertEqual(parsed.allDay, true);

  // Verify recurrence info
  if (!parsed.recurrence) {
    throw new Error("Recurrence info missing");
  }
  assertEqual(parsed.recurrence.frequency, "YEARLY");

  // Verify human-readable format
  assertContains(parsed.recurrence.humanReadable, "yearly");
});

// Test 10: Edge case - empty optional fields
test("Event with minimal fields", () => {
  const start = new Date("2025-12-30T12:00:00Z");

  const params: CreateEventParams = {
    summary: "Minimal Event",
    start,
  };

  const { icalString, uid } = createICalString(params);

  // Should have required fields only
  assertContains(icalString, "BEGIN:VCALENDAR");
  assertContains(icalString, "BEGIN:VEVENT");
  assertContains(icalString, "SUMMARY:Minimal Event");
  assertContains(icalString, `UID:${uid}`);

  // Parse it back
  const parsed = parseICalEvent(icalString, "test-url");
  if (!parsed) {
    throw new Error("Failed to parse generated iCal");
  }

  assertEqual(parsed.summary, "Minimal Event");
  assertDatesEqual(parsed.start, start);
  assertEqual(parsed.location, undefined);
  assertEqual(parsed.description, undefined);
  assertEqual(parsed.recurrence, undefined);
});

// =============================================================================
// Results
// =============================================================================

console.log("\n" + "=".repeat(60));
console.log(`📊 Test Results: ${passCount}/${testCount} passed`);
if (failCount > 0) {
  console.log(`❌ ${failCount} test(s) failed`);
  process.exit(1);
} else {
  console.log(`✅ All tests passed!`);
  process.exit(0);
}
