import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DAVClient, DAVAddressBook } from "tsdav";

import {
  createContactsClient,
  fetchAddressBooks,
  fetchContacts,
  searchContacts,
  formatAddressBookAsCSV,
  formatContactAsCSV,
  createVCardString,
  updateVCardString,
  generateVCardFilename,
  parseVCard,
  ContactsClientConfig,
} from "../contacts.js";
import { formatError, mcpResponse } from "../utils.js";

// =============================================================================
// Schemas
// =============================================================================

const AddressBooksSchema = z.object({});

const ContactsSchema = z.object({
  addressBook: z.string().optional().describe(
    "Address book URL, display name, or 'default' for primary. If omitted, returns contacts from all address books."
  ),
  query: z.string().optional().describe(
    "Search query to filter contacts by name, email, phone, or organization"
  ),
  limit: z.number().min(1).max(100).default(50).describe(
    "Maximum contacts to return (default 50)"
  ),
});

const EmailSchema = z.object({
  type: z.enum(["work", "home", "other"]).optional().describe("Email type"),
  value: z.string().email().describe("Email address"),
});

const PhoneSchema = z.object({
  type: z.enum(["cell", "work", "home", "fax", "other"]).optional().describe("Phone type"),
  value: z.string().min(1).describe("Phone number"),
});

// Accept either simple strings or objects with type/value
const EmailInputSchema = z.union([
  z.string().email(),
  EmailSchema,
]);

const PhoneInputSchema = z.union([
  z.string().min(1),
  PhoneSchema,
]);

// Normalize mixed input to consistent format
const normalizeEmails = (emails?: Array<string | { type?: string; value: string }>): Array<{ type?: string; value: string }> => {
  if (!emails) return [];
  return emails.map((e) => (typeof e === "string" ? { value: e } : e));
};

const normalizePhones = (phones?: Array<string | { type?: string; value: string }>): Array<{ type?: string; value: string }> => {
  if (!phones) return [];
  return phones.map((p) => (typeof p === "string" ? { value: p } : p));
};

const CreateContactSchema = z.object({
  addressBook: z.string().min(1).default("default").describe(
    "Address book to add contact to (URL, display name, or 'default' for primary address book)"
  ),
  fullName: z.string().min(1).describe(
    "Contact's full name"
  ),
  emails: z.array(EmailInputSchema).optional().describe(
    'Email addresses. Simple strings ["john@work.com"] or objects [{"type": "work", "value": "john@work.com"}]'
  ),
  phones: z.array(PhoneInputSchema).optional().describe(
    'Phone numbers. Simple strings ["+1-555-1234"] or objects [{"type": "cell", "value": "+1-555-1234"}]'
  ),
  organization: z.string().optional().describe(
    "Company or organization name"
  ),
  title: z.string().optional().describe(
    "Job title"
  ),
  notes: z.string().optional().describe(
    "Additional notes about the contact"
  ),
});

const UpdateContactSchema = z.object({
  contact: z.string().describe(
    "Contact URL (from 'contacts' tool) OR unique search query (name/email/phone). If query matches multiple contacts, operation fails."
  ),
  fullName: z.string().optional().describe(
    "New full name for the contact"
  ),
  emails: z.array(EmailInputSchema).optional().describe(
    'New email addresses (replaces all existing). Use [] to clear.'
  ),
  phones: z.array(PhoneInputSchema).optional().describe(
    'New phone numbers (replaces all existing). Use [] to clear.'
  ),
  organization: z.string().optional().describe(
    "New company/organization. Use empty string to clear."
  ),
  title: z.string().optional().describe(
    "New job title. Use empty string to clear."
  ),
  notes: z.string().optional().describe(
    "New notes. Use empty string to clear."
  ),
});

const DeleteContactSchema = z.object({
  contact: z.string().describe(
    "Contact URL (from 'contacts' tool) OR unique search query (name/email/phone). If query matches multiple contacts, operation fails."
  ),
});

// =============================================================================
// Contacts Tools Registration
// =============================================================================

export function registerContactsTools(
  server: McpServer,
  contactsClient: DAVClient | null,
  config: ContactsClientConfig | null,
): void {
  // Helper to ensure we have a client
  const getClient = async (): Promise<DAVClient> => {
    if (contactsClient) {
      return contactsClient;
    }
    if (!config) {
      throw new Error(
        "Contacts access not configured. Set FASTMAIL_USERNAME and FASTMAIL_PASSWORD (app password) environment variables."
      );
    }
    return await createContactsClient(config);
  };

  // Cache of address books for name resolution
  let addressBooksCache: DAVAddressBook[] | null = null;

  const getAddressBooks = async (client: DAVClient): Promise<DAVAddressBook[]> => {
    if (!addressBooksCache) {
      addressBooksCache = await client.fetchAddressBooks();
    }
    return addressBooksCache;
  };

  const resolveAddressBook = async (
    client: DAVClient,
    nameOrUrl: string
  ): Promise<DAVAddressBook | undefined> => {
    const addressBooks = await getAddressBooks(client);

    // Handle 'default' keyword - return first non-hidden address book
    if (nameOrUrl.toLowerCase() === "default") {
      return addressBooks.find((ab) => {
        const name = typeof ab.displayName === "string" ? ab.displayName : "";
        return !name.startsWith("_");
      }) || addressBooks[0];
    }

    // First try exact URL match
    const byUrl = addressBooks.find((ab) => ab.url === nameOrUrl);
    if (byUrl) return byUrl;
    // Then try display name match (case-insensitive)
    const byName = addressBooks.find((ab) => {
      const name = typeof ab.displayName === "string" ? ab.displayName : "";
      return name.toLowerCase() === nameOrUrl.toLowerCase();
    });
    return byName;
  };

  // ---------------------------------------------------------------------------
  // address_books - List all address books
  // ---------------------------------------------------------------------------

  server.tool(
    "address_books",
    `List address books in the user's Fastmail account.

Returns: url, display_name, ctag, description
Use the URL or display_name when fetching contacts from a specific address book.`,
    AddressBooksSchema.shape,
    async () => {
      try {
        const client = await getClient();
        const addressBookInfos = await fetchAddressBooks(client);
        return mcpResponse(formatAddressBookAsCSV(addressBookInfos));
      } catch (error) {
        return mcpResponse(formatError(error), true);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // contacts - List or search contacts
  // ---------------------------------------------------------------------------

  server.tool(
    "contacts",
    `Get contacts from Fastmail.

Returns: uid, url, full_name, emails, phones, organization
Filter by address book or search by name/email/organization.`,
    ContactsSchema.shape,
    async (args) => {
      try {
        const client = await getClient();
        const addressBooks = await getAddressBooks(client);

        // Determine which address books to fetch from
        let targetAddressBooks: DAVAddressBook[] = addressBooks;
        if (args.addressBook) {
          const resolved = await resolveAddressBook(client, args.addressBook);
          if (!resolved) {
            const available = addressBooks.map((ab) => ab.displayName).join(", ");
            return mcpResponse(
              `Address book not found: "${args.addressBook}". Available: ${available}`,
              true
            );
          }
          targetAddressBooks = [resolved];
        }

        // Fetch contacts from all target address books
        let allContacts = [];
        for (const addressBook of targetAddressBooks) {
          const contacts = await fetchContacts(client, addressBook);
          allContacts.push(...contacts);
        }

        // Apply search filter if provided
        if (args.query) {
          allContacts = searchContacts(allContacts, args.query);
        }

        // Sort by name
        allContacts.sort((a, b) => a.fullName.localeCompare(b.fullName));

        // Apply limit
        const limited = allContacts.slice(0, args.limit);

        return mcpResponse(formatContactAsCSV(limited));
      } catch (error) {
        return mcpResponse(formatError(error), true);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // create_contact - Create a new contact
  // ---------------------------------------------------------------------------

  server.tool(
    "create_contact",
    `Create a new contact.

Example: create_contact(fullName: "John Doe", emails: ["john@work.com"], phones: ["+1-555-1234"])

Returns the created contact's UID and URL on success.`,
    CreateContactSchema.shape,
    async (args) => {
      try {
        const client = await getClient();

        // Resolve address book by name or URL
        const addressBook = await resolveAddressBook(client, args.addressBook);
        if (!addressBook) {
          const addressBooks = await getAddressBooks(client);
          const available = addressBooks.map((ab) => ab.displayName).join(", ");
          return mcpResponse(
            `Address book not found: "${args.addressBook}". Available: ${available}`,
            true
          );
        }

        // Normalize emails and phones to consistent format
        const emails = normalizeEmails(args.emails as any);
        const phones = normalizePhones(args.phones as any);

        // Create vCard string
        const { vCardString, uid } = createVCardString({
          fullName: args.fullName,
          emails,
          phones,
          organization: args.organization,
          title: args.title,
          notes: args.notes,
        });

        // Create the contact via CardDAV
        const filename = generateVCardFilename(uid);
        const response = await client.createVCard({
          addressBook,
          vCardString,
          filename,
        });

        if (!response.ok) {
          return mcpResponse(
            `Failed to create contact: ${response.status} ${response.statusText}`,
            true
          );
        }

        // Construct the contact URL
        const contactUrl = `${addressBook.url}${filename}`;

        return mcpResponse(
          `Contact created successfully.\nUID: ${uid}\nURL: ${contactUrl}`
        );
      } catch (error) {
        return mcpResponse(formatError(error), true);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // update_contact - Update an existing contact
  // ---------------------------------------------------------------------------

  // Helper to resolve contact by URL or query
  const resolveContactUrl = async (
    client: DAVClient,
    contactRef: string
  ): Promise<{ url: string; data: string; etag?: string } | { error: string }> => {
    // Check if it's a URL
    if (contactRef.startsWith("http")) {
      // Extract address book URL from contact URL (everything before the last path segment)
      const urlParts = contactRef.split("/");
      const addressBookUrl = urlParts.slice(0, -1).join("/") + "/";

      const fetchResponse = await client.fetchVCards({
        addressBook: { url: addressBookUrl } as DAVAddressBook,
        objectUrls: [contactRef],
      });
      if (!fetchResponse || fetchResponse.length === 0 || !fetchResponse[0].data) {
        return { error: `Contact not found: "${contactRef}"` };
      }
      return { url: contactRef, data: fetchResponse[0].data, etag: fetchResponse[0].etag };
    }

    // Otherwise, search for the contact
    const addressBooks = await getAddressBooks(client);
    let allContacts: Array<{ url: string; data: string; etag?: string; parsed: any }> = [];

    for (const addressBook of addressBooks) {
      const vcards = await client.fetchVCards({ addressBook });
      for (const vcard of vcards) {
        if (vcard.data) {
          const parsed = parseVCard(vcard.data, vcard.url);
          if (parsed) {
            allContacts.push({ url: vcard.url, data: vcard.data, etag: vcard.etag, parsed });
          }
        }
      }
    }

    // Search for matches
    const matches = allContacts.filter((c) => {
      const lowerQuery = contactRef.toLowerCase();
      return (
        c.parsed.fullName.toLowerCase().includes(lowerQuery) ||
        c.parsed.emails.some((e: any) => e.value.toLowerCase().includes(lowerQuery)) ||
        c.parsed.phones.some((p: any) => p.value.includes(contactRef)) ||
        c.parsed.organization?.toLowerCase().includes(lowerQuery)
      );
    });

    if (matches.length === 0) {
      return { error: `No contact found matching: "${contactRef}"` };
    }
    if (matches.length > 1) {
      const names = matches.map((c) => c.parsed.fullName).join(", ");
      return { error: `Multiple contacts found matching "${contactRef}": ${names}. Use the exact URL from 'contacts' tool.` };
    }

    return { url: matches[0].url, data: matches[0].data, etag: matches[0].etag };
  };

  server.tool(
    "update_contact",
    `Update an existing contact.

Example: update_contact(contact: "John Doe", phones: ["+1-555-9999"])

Accepts contact URL or unique search query (name/email/phone). Use empty string to clear text, [] to clear arrays.`,
    UpdateContactSchema.shape,
    async (args) => {
      try {
        const client = await getClient();

        // Resolve contact by URL or query
        const resolved = await resolveContactUrl(client, args.contact);
        if ("error" in resolved) {
          return mcpResponse(resolved.error, true);
        }

        // Normalize emails and phones
        const emails = args.emails !== undefined ? normalizeEmails(args.emails as any) : undefined;
        const phones = args.phones !== undefined ? normalizePhones(args.phones as any) : undefined;

        // Update the vCard string
        const updatedVCardString = updateVCardString(resolved.data, {
          fullName: args.fullName,
          emails,
          phones,
          organization: args.organization,
          title: args.title,
          notes: args.notes,
        });

        // Update the contact via CardDAV
        const response = await client.updateVCard({
          vCard: {
            url: resolved.url,
            data: updatedVCardString,
            etag: resolved.etag,
          },
        });

        if (!response.ok) {
          return mcpResponse(
            `Failed to update contact: ${response.status} ${response.statusText}`,
            true
          );
        }

        return mcpResponse(`Contact updated successfully.`);
      } catch (error) {
        return mcpResponse(formatError(error), true);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // delete_contact - Delete a contact
  // ---------------------------------------------------------------------------

  server.tool(
    "delete_contact",
    `Delete a contact.

Example: delete_contact(contact: "John Doe")

Accepts contact URL or unique search query (name/email/phone).`,
    DeleteContactSchema.shape,
    async (args) => {
      try {
        const client = await getClient();

        // Resolve contact by URL or query
        const resolved = await resolveContactUrl(client, args.contact);
        if ("error" in resolved) {
          return mcpResponse(resolved.error, true);
        }

        // Delete by URL
        const response = await client.deleteObject({
          url: resolved.url,
        });

        if (!response.ok) {
          return mcpResponse(
            `Failed to delete contact: ${response.status} ${response.statusText}`,
            true
          );
        }

        return mcpResponse(`Contact deleted successfully.`);
      } catch (error) {
        return mcpResponse(formatError(error), true);
      }
    }
  );
}
