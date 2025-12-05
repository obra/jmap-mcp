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
  ContactsClientConfig,
} from "../contacts.js";
import { formatError, mcpResponse } from "../utils.js";

// =============================================================================
// Schemas
// =============================================================================

const AddressBooksSchema = z.object({});

const ContactsSchema = z.object({
  addressBook: z.string().optional().describe(
    "Address book URL or display name. If omitted, returns contacts from all address books."
  ),
  query: z.string().optional().describe(
    "Search query to filter contacts by name, email, or organization"
  ),
  limit: z.number().min(1).max(100).default(50).describe(
    "Maximum contacts to return (default 50)"
  ),
});

const EmailSchema = z.object({
  type: z.string().optional().describe("Email type: work, home, other"),
  value: z.string().describe("Email address"),
});

const PhoneSchema = z.object({
  type: z.string().optional().describe("Phone type: cell, work, home, fax, other"),
  value: z.string().describe("Phone number"),
});

const CreateContactSchema = z.object({
  addressBook: z.string().describe(
    "Address book to add contact to (URL or display name). Use 'address_books' tool to list available address books."
  ),
  fullName: z.string().describe(
    "Contact's full name"
  ),
  emails: z.array(EmailSchema).optional().describe(
    'Email addresses with optional types, e.g., [{"type": "work", "value": "john@work.com"}]'
  ),
  phones: z.array(PhoneSchema).optional().describe(
    'Phone numbers with optional types, e.g., [{"type": "cell", "value": "+1-555-1234"}]'
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
  url: z.string().describe(
    "The full URL of the contact to update (returned by 'contacts' tool or 'create_contact')"
  ),
  fullName: z.string().optional().describe(
    "New full name for the contact"
  ),
  emails: z.array(EmailSchema).optional().describe(
    'New email addresses (replaces all existing). Use [] to clear.'
  ),
  phones: z.array(PhoneSchema).optional().describe(
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
  url: z.string().describe(
    "The full URL of the contact to delete (returned by 'contacts' tool or 'create_contact')"
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
    // First try exact URL match
    const byUrl = addressBooks.find((ab) => ab.url === nameOrUrl);
    if (byUrl) return byUrl;
    // Then try display name match (case-insensitive)
    const byName = addressBooks.find(
      (ab) => ab.displayName?.toLowerCase() === nameOrUrl.toLowerCase()
    );
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
            return mcpResponse(
              `Address book not found: "${args.addressBook}". Use the 'address_books' tool to list available address books.`,
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

Example: create_contact(addressBook: "Default", fullName: "John Doe", emails: [{"type": "work", "value": "john@work.com"}], phones: [{"type": "cell", "value": "+1-555-1234"}])

Returns the created contact's UID and URL on success.`,
    CreateContactSchema.shape,
    async (args) => {
      try {
        const client = await getClient();

        // Resolve address book by name or URL
        const addressBook = await resolveAddressBook(client, args.addressBook);
        if (!addressBook) {
          return mcpResponse(
            `Address book not found: "${args.addressBook}". Use the 'address_books' tool to list available address books.`,
            true
          );
        }

        // Create vCard string
        const { vCardString, uid } = createVCardString({
          fullName: args.fullName,
          emails: args.emails,
          phones: args.phones,
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

  server.tool(
    "update_contact",
    `Update an existing contact.

Example: update_contact(url: "https://carddav.fastmail.com/.../contact.vcf", fullName: "John Smith", organization: "New Corp")

Only provide fields you want to change. Use empty string to clear text fields, empty array [] to clear emails/phones.`,
    UpdateContactSchema.shape,
    async (args) => {
      try {
        const client = await getClient();

        // Fetch the existing contact
        const fetchResponse = await client.fetchVCards({
          objectUrls: [args.url],
        });

        if (!fetchResponse || fetchResponse.length === 0) {
          return mcpResponse(
            `Contact not found: "${args.url}"`,
            true
          );
        }

        const existingContact = fetchResponse[0];
        if (!existingContact.data) {
          return mcpResponse(
            `Contact has no data: "${args.url}"`,
            true
          );
        }

        // Update the vCard string
        const updatedVCardString = updateVCardString(existingContact.data, {
          fullName: args.fullName,
          emails: args.emails,
          phones: args.phones,
          organization: args.organization,
          title: args.title,
          notes: args.notes,
        });

        // Update the contact via CardDAV
        const response = await client.updateVCard({
          vCard: {
            url: args.url,
            data: updatedVCardString,
            etag: existingContact.etag,
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
    `Delete a contact by URL.

Get the contact URL from the 'contacts' tool or 'create_contact' response.

Example: delete_contact(url: "https://carddav.fastmail.com/dav/addressbooks/.../contact.vcf")`,
    DeleteContactSchema.shape,
    async (args) => {
      try {
        const client = await getClient();

        // Delete by URL without etag
        const response = await client.deleteObject({
          url: args.url,
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
