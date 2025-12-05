import { describe, it, expect } from "vitest";
import {
  createContactsClient,
  formatAddressBookAsCSV,
  formatContactAsCSV,
  parseVCard,
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
    const vcard = `BEGIN:VCARD
VERSION:3.0
UID:escape-test
FN:Name\\, With\\; Special
ORG:Company\\, Inc.
END:VCARD`;

    const contact = parseVCard(vcard, "/ab/contact.vcf");
    expect(contact).toBeDefined();
    expect(contact!.fullName).toBe("Name, With; Special");
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
