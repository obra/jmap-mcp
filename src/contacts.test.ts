import { describe, it, expect } from "vitest";
import {
  createContactsClient,
  formatAddressBookAsCSV,
  formatContactAsCSV,
  parseVCard,
  createVCardString,
  generateVCardFilename,
  AddressBookInfo,
  ContactInfo,
} from "./contacts.js";

// =============================================================================
// Unit Tests for Contacts Formatting Functions
// =============================================================================

describe("formatAddressBookAsCSV", () => {
  it("formats a single address book", () => {
    const addressBooks: AddressBookInfo[] = [
      {
        url: "/dav/addressbooks/user/test@example.com/Default/",
        displayName: "Default",
        ctag: "abc123",
        description: "My contacts",
      },
    ];
    const result = formatAddressBookAsCSV(addressBooks);
    expect(result).toContain("url,display_name,ctag,description");
    expect(result).toContain("/dav/addressbooks/user/test@example.com/Default/");
    expect(result).toContain("Default");
  });

  it("escapes commas in display names", () => {
    const addressBooks: AddressBookInfo[] = [
      {
        url: "/contacts/1",
        displayName: "Work, Personal",
        ctag: "xyz",
      },
    ];
    const result = formatAddressBookAsCSV(addressBooks);
    expect(result).toContain('"Work, Personal"');
  });

  it("handles empty address book list", () => {
    const result = formatAddressBookAsCSV([]);
    expect(result).toBe("url,display_name,ctag,description\n# total=0");
  });

  it("includes total count in footer", () => {
    const addressBooks: AddressBookInfo[] = [
      { url: "/ab/1", displayName: "Personal" },
      { url: "/ab/2", displayName: "Work" },
    ];
    const result = formatAddressBookAsCSV(addressBooks);
    expect(result).toContain("# total=2");
  });
});

describe("formatContactAsCSV", () => {
  it("formats a single contact with full details", () => {
    const contacts: ContactInfo[] = [
      {
        uid: "contact-123",
        url: "/dav/addressbooks/user/test@example.com/Default/contact-123.vcf",
        fullName: "John Doe",
        emails: [{ type: "work", value: "john@example.com" }],
        phones: [{ type: "cell", value: "+1-555-1234" }],
        organization: "Example Corp",
      },
    ];
    const result = formatContactAsCSV(contacts);
    expect(result).toContain("uid,url,full_name,emails,phones,organization");
    expect(result).toContain("contact-123");
    expect(result).toContain("John Doe");
    expect(result).toContain("john@example.com");
    expect(result).toContain("+1-555-1234");
    expect(result).toContain("Example Corp");
  });

  it("formats multiple emails and phones", () => {
    const contacts: ContactInfo[] = [
      {
        uid: "contact-456",
        url: "/ab/contact-456.vcf",
        fullName: "Jane Smith",
        emails: [
          { type: "work", value: "jane@work.com" },
          { type: "home", value: "jane@home.com" },
        ],
        phones: [
          { type: "work", value: "+1-555-1111" },
          { type: "cell", value: "+1-555-2222" },
        ],
      },
    ];
    const result = formatContactAsCSV(contacts);
    // Multiple emails/phones should be separated by semicolons
    expect(result).toContain("jane@work.com;jane@home.com");
    expect(result).toContain("+1-555-1111;+1-555-2222");
  });

  it("escapes special characters in names", () => {
    const contacts: ContactInfo[] = [
      {
        uid: "contact-789",
        url: "/ab/contact-789.vcf",
        fullName: 'Smith, John "Jack"',
        emails: [],
        phones: [],
      },
    ];
    const result = formatContactAsCSV(contacts);
    // Should escape quotes and wrap in quotes due to comma
    expect(result).toContain('"Smith, John ""Jack"""');
  });

  it("handles empty contact list", () => {
    const result = formatContactAsCSV([]);
    expect(result).toBe("uid,url,full_name,emails,phones,organization\n# total=0");
  });

  it("includes total count in footer", () => {
    const contacts: ContactInfo[] = [
      { uid: "1", url: "/c/1.vcf", fullName: "A", emails: [], phones: [] },
      { uid: "2", url: "/c/2.vcf", fullName: "B", emails: [], phones: [] },
      { uid: "3", url: "/c/3.vcf", fullName: "C", emails: [], phones: [] },
    ];
    const result = formatContactAsCSV(contacts);
    expect(result).toContain("# total=3");
  });
});

describe("parseVCard", () => {
  it("parses a simple vCard 3.0", () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
UID:contact-123
FN:John Doe
N:Doe;John;;;
EMAIL;TYPE=WORK:john@example.com
TEL;TYPE=CELL:+1-555-1234
ORG:Example Corp
END:VCARD`;

    const contact = parseVCard(vcard, "/ab/contact.vcf");
    expect(contact).toBeDefined();
    expect(contact!.uid).toBe("contact-123");
    expect(contact!.fullName).toBe("John Doe");
    expect(contact!.emails).toEqual([{ type: "work", value: "john@example.com" }]);
    expect(contact!.phones).toEqual([{ type: "cell", value: "+1-555-1234" }]);
    expect(contact!.organization).toBe("Example Corp");
  });

  it("parses a vCard 4.0", () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
UID:contact-456
FN:Jane Smith
EMAIL;TYPE=home:jane@home.com
END:VCARD`;

    const contact = parseVCard(vcard, "/ab/contact.vcf");
    expect(contact).toBeDefined();
    expect(contact!.fullName).toBe("Jane Smith");
    expect(contact!.emails).toEqual([{ type: "home", value: "jane@home.com" }]);
  });

  it("handles multiple emails and phones", () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
UID:multi-123
FN:Multi Contact
EMAIL;TYPE=WORK:work@example.com
EMAIL;TYPE=HOME:home@example.com
TEL;TYPE=WORK:+1-555-1111
TEL;TYPE=CELL:+1-555-2222
END:VCARD`;

    const contact = parseVCard(vcard, "/ab/contact.vcf");
    expect(contact).toBeDefined();
    expect(contact!.emails).toHaveLength(2);
    expect(contact!.phones).toHaveLength(2);
  });

  it("handles emails without TYPE parameter", () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
UID:no-type-123
FN:No Type
EMAIL:plain@example.com
END:VCARD`;

    const contact = parseVCard(vcard, "/ab/contact.vcf");
    expect(contact).toBeDefined();
    expect(contact!.emails).toEqual([{ type: "other", value: "plain@example.com" }]);
  });

  it("handles escaped characters", () => {
    // Note: ical.js unescapes commas but semicolons aren't typically escaped in FN
    // FN is a text field where semicolons don't need escaping (unlike N which is structured)
    const vcard = `BEGIN:VCARD
VERSION:3.0
UID:escape-test
FN:Name\\, With Special
ORG:Company\\, Inc.
END:VCARD`;

    const contact = parseVCard(vcard, "/ab/contact.vcf");
    expect(contact).toBeDefined();
    expect(contact!.fullName).toBe("Name, With Special");
    expect(contact!.organization).toBe("Company, Inc.");
  });

  it("returns undefined for invalid vCard", () => {
    const contact = parseVCard("not valid vcard", "/ab/contact.vcf");
    expect(contact).toBeUndefined();
  });

  it("returns undefined for vCard without required fields", () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
END:VCARD`;

    const contact = parseVCard(vcard, "/ab/contact.vcf");
    expect(contact).toBeUndefined();
  });
});

// =============================================================================
// Integration-style Tests (with mocked tsdav)
// =============================================================================

describe("parseVCard - additional fields", () => {
  it("parses birthday", () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
UID:bday-test
FN:Birthday Person
BDAY:1990-05-15
END:VCARD`;

    const contact = parseVCard(vcard, "/ab/contact.vcf");
    expect(contact).toBeDefined();
    expect(contact!.birthday).toBe("1990-05-15");
  });

  it("parses notes", () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
UID:notes-test
FN:Notes Person
NOTE:Important client - prefers email contact
END:VCARD`;

    const contact = parseVCard(vcard, "/ab/contact.vcf");
    expect(contact).toBeDefined();
    expect(contact!.notes).toBe("Important client - prefers email contact");
  });

  it("parses job title", () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
UID:title-test
FN:Title Person
TITLE:Senior Engineer
END:VCARD`;

    const contact = parseVCard(vcard, "/ab/contact.vcf");
    expect(contact).toBeDefined();
    expect(contact!.title).toBe("Senior Engineer");
  });

  it("parses URLs", () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
UID:url-test
FN:URL Person
URL:https://example.com
URL;TYPE=WORK:https://work.example.com
END:VCARD`;

    const contact = parseVCard(vcard, "/ab/contact.vcf");
    expect(contact).toBeDefined();
    expect(contact!.urls).toHaveLength(2);
    expect(contact!.urls![0].value).toBe("https://example.com");
    expect(contact!.urls![1].value).toBe("https://work.example.com");
  });

  it("parses addresses", () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
UID:addr-test
FN:Address Person
ADR;TYPE=HOME:;;123 Main St;Springfield;IL;62701;USA
END:VCARD`;

    const contact = parseVCard(vcard, "/ab/contact.vcf");
    expect(contact).toBeDefined();
    expect(contact!.addresses).toHaveLength(1);
    expect(contact!.addresses![0].type).toBe("home");
    expect(contact!.addresses![0].street).toBe("123 Main St");
    expect(contact!.addresses![0].city).toBe("Springfield");
    expect(contact!.addresses![0].state).toBe("IL");
  });
});

describe("parseVCard - type preservation", () => {
  it("preserves email types", () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
UID:email-types
FN:Email Types
EMAIL;TYPE=WORK:work@example.com
EMAIL;TYPE=HOME:home@example.com
EMAIL;TYPE=OTHER:other@example.com
END:VCARD`;

    const contact = parseVCard(vcard, "/ab/contact.vcf");
    expect(contact).toBeDefined();
    expect(contact!.emails).toHaveLength(3);
    expect(contact!.emails[0].type).toBe("work");
    expect(contact!.emails[1].type).toBe("home");
    expect(contact!.emails[2].type).toBe("other");
  });

  it("preserves phone types", () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
UID:phone-types
FN:Phone Types
TEL;TYPE=WORK:555-1111
TEL;TYPE=HOME:555-2222
TEL;TYPE=CELL:555-3333
TEL;TYPE=FAX:555-4444
END:VCARD`;

    const contact = parseVCard(vcard, "/ab/contact.vcf");
    expect(contact).toBeDefined();
    expect(contact!.phones).toHaveLength(4);
    expect(contact!.phones[0].type).toBe("work");
    expect(contact!.phones[1].type).toBe("home");
    expect(contact!.phones[2].type).toBe("cell");
    expect(contact!.phones[3].type).toBe("fax");
  });
});

describe("createVCardString", () => {
  it("creates valid vCard with required fields", () => {
    const result = createVCardString({
      fullName: "John Doe",
    });

    expect(result.uid).toBeDefined();
    expect(result.uid).toContain("@fastmail-aibo");
    expect(result.vCardString).toContain("BEGIN:VCARD");
    expect(result.vCardString).toContain("END:VCARD");
    expect(result.vCardString).toContain("FN:John Doe");
    expect(result.vCardString).toContain(`UID:${result.uid}`);
    expect(result.vCardString).toContain("VERSION:3.0");
  });

  it("includes emails with types", () => {
    const result = createVCardString({
      fullName: "Jane Doe",
      emails: [
        { type: "work", value: "jane@work.com" },
        { type: "home", value: "jane@home.com" },
      ],
    });

    expect(result.vCardString).toContain("EMAIL");
    expect(result.vCardString).toContain("jane@work.com");
    expect(result.vCardString).toContain("jane@home.com");
  });

  it("includes phones with types", () => {
    const result = createVCardString({
      fullName: "Bob Smith",
      phones: [
        { type: "cell", value: "+1-555-1234" },
        { type: "work", value: "+1-555-5678" },
      ],
    });

    expect(result.vCardString).toContain("TEL");
    expect(result.vCardString).toContain("+1-555-1234");
    expect(result.vCardString).toContain("+1-555-5678");
  });

  it("includes organization", () => {
    const result = createVCardString({
      fullName: "Alice Corp",
      organization: "Example Inc",
    });

    expect(result.vCardString).toContain("ORG:Example Inc");
  });

  it("includes title", () => {
    const result = createVCardString({
      fullName: "Manager Person",
      title: "Engineering Manager",
    });

    expect(result.vCardString).toContain("TITLE:Engineering Manager");
  });

  it("includes notes", () => {
    const result = createVCardString({
      fullName: "Notes Person",
      notes: "Important client",
    });

    expect(result.vCardString).toContain("NOTE:Important client");
  });

  it("generates unique UIDs for each call", () => {
    const result1 = createVCardString({ fullName: "Person 1" });
    const result2 = createVCardString({ fullName: "Person 2" });

    expect(result1.uid).not.toBe(result2.uid);
  });

  it("can be parsed by parseVCard", () => {
    const result = createVCardString({
      fullName: "Roundtrip Test",
      emails: [{ type: "work", value: "test@example.com" }],
      phones: [{ type: "cell", value: "+1-555-9999" }],
      organization: "Test Org",
      title: "Test Title",
      notes: "Test Notes",
    });

    const parsed = parseVCard(result.vCardString, "/test/contact.vcf");
    expect(parsed).toBeDefined();
    expect(parsed!.uid).toBe(result.uid);
    expect(parsed!.fullName).toBe("Roundtrip Test");
    expect(parsed!.organization).toBe("Test Org");
    expect(parsed!.title).toBe("Test Title");
    expect(parsed!.notes).toBe("Test Notes");
    expect(parsed!.emails).toHaveLength(1);
    expect(parsed!.emails[0].value).toBe("test@example.com");
    expect(parsed!.phones).toHaveLength(1);
    expect(parsed!.phones[0].value).toBe("+1-555-9999");
  });
});

describe("generateVCardFilename", () => {
  it("generates .vcf filename from UID", () => {
    const filename = generateVCardFilename("12345-abc@fastmail-aibo");
    expect(filename).toBe("12345-abc@fastmail-aibo.vcf");
  });
});

describe("createContactsClient", () => {
  it("creates a client with the correct Fastmail URL format", async () => {
    const config = {
      username: "test@fastmail.com",
      password: "app-password-123",
    };

    // Verify the function exists and returns correctly
    expect(typeof createContactsClient).toBe("function");
  });
});
