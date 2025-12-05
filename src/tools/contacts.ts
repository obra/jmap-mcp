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
}
