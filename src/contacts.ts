import { DAVClient, DAVAddressBook, DAVVCard } from "tsdav";

// =============================================================================
// Types
// =============================================================================

export interface AddressBookInfo {
  url: string;
  displayName: string;
  ctag?: string;
  description?: string;
}

export interface ContactEmail {
  type: string;
  value: string;
}

export interface ContactPhone {
  type: string;
  value: string;
}

export interface ContactInfo {
  uid: string;
  url: string;
  fullName: string;
  emails: ContactEmail[];
  phones: ContactPhone[];
  organization?: string;
}

export interface ContactsClientConfig {
  username: string;
  password: string;
}

// =============================================================================
// CSV Escaping (reusing pattern from email utils)
// =============================================================================

const escapeCSVField = (value: string | undefined | null): string => {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

// =============================================================================
// Address Book Formatting
// =============================================================================

export const formatAddressBookAsCSV = (addressBooks: AddressBookInfo[]): string => {
  const header = "url,display_name,ctag,description";
  if (addressBooks.length === 0) {
    return `${header}\n# total=0`;
  }

  const rows = addressBooks.map((ab) =>
    [
      escapeCSVField(ab.url),
      escapeCSVField(ab.displayName),
      escapeCSVField(ab.ctag),
      escapeCSVField(ab.description),
    ].join(",")
  );

  return `${header}\n${rows.join("\n")}\n# total=${addressBooks.length}`;
};

export const formatContactAsCSV = (contacts: ContactInfo[]): string => {
  const header = "uid,url,full_name,emails,phones,organization";
  if (contacts.length === 0) {
    return `${header}\n# total=0`;
  }

  const rows = contacts.map((contact) => {
    // Format emails and phones as semicolon-separated strings
    const emailsStr = contact.emails.map((e) => e.value).join(";");
    const phonesStr = contact.phones.map((p) => p.value).join(";");

    return [
      escapeCSVField(contact.uid),
      escapeCSVField(contact.url),
      escapeCSVField(contact.fullName),
      escapeCSVField(emailsStr),
      escapeCSVField(phonesStr),
      escapeCSVField(contact.organization),
    ].join(",");
  });

  return `${header}\n${rows.join("\n")}\n# total=${contacts.length}`;
};

// =============================================================================
// vCard Parsing
// =============================================================================

/**
 * Parse vCard content and extract contact details
 * Handles common vCard 3.0 and 4.0 formats
 */
export const parseVCard = (
  vcardContent: string,
  url: string
): ContactInfo | undefined => {
  // Check for valid structure
  if (!vcardContent.includes("BEGIN:VCARD") || !vcardContent.includes("END:VCARD")) {
    return undefined;
  }

  // Helper to unescape vCard values
  const unescape = (value: string): string => {
    return value
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";")
      .replace(/\\n/g, "\n")
      .replace(/\\\\/g, "\\");
  };

  // Helper to extract a simple property value
  const extractProperty = (name: string): string | undefined => {
    const regex = new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, "im");
    const match = vcardContent.match(regex);
    if (match) {
      return unescape(match[1].trim());
    }
    return undefined;
  };

  // Helper to extract typed properties (like EMAIL;TYPE=WORK:value)
  const extractTypedProperties = (name: string): { type: string; value: string }[] => {
    const results: { type: string; value: string }[] = [];
    const regex = new RegExp(`^${name}(?:;([^:]*)?)?:(.*)$`, "gim");
    let match;

    while ((match = regex.exec(vcardContent)) !== null) {
      const params = match[1] || "";
      const value = unescape(match[2].trim());

      // Extract TYPE from parameters (e.g., "TYPE=WORK" or just "WORK")
      let type = "other";
      const typeMatch = params.match(/TYPE=([^;,]+)/i) || params.match(/^([A-Za-z]+)$/);
      if (typeMatch) {
        type = typeMatch[1].toLowerCase();
      }

      results.push({ type, value });
    }

    return results;
  };

  const uid = extractProperty("UID");
  const fullName = extractProperty("FN");
  const organization = extractProperty("ORG");
  const emails = extractTypedProperties("EMAIL");
  const phones = extractTypedProperties("TEL");

  // UID and FN are required
  if (!uid || !fullName) {
    return undefined;
  }

  return {
    uid,
    url,
    fullName,
    emails,
    phones,
    organization,
  };
};

// =============================================================================
// CardDAV Client
// =============================================================================

/**
 * Creates a CardDAV client configured for Fastmail
 */
export const createContactsClient = async (
  config: ContactsClientConfig
): Promise<DAVClient> => {
  const serverUrl = `https://carddav.fastmail.com/dav/addressbooks/user/${config.username}/`;

  const client = new DAVClient({
    serverUrl,
    credentials: {
      username: config.username,
      password: config.password,
    },
    authMethod: "Basic",
    defaultAccountType: "carddav",
  });

  await client.login();
  return client;
};

/**
 * Fetch all address books for the authenticated user
 */
export const fetchAddressBooks = async (client: DAVClient): Promise<AddressBookInfo[]> => {
  const addressBooks = await client.fetchAddressBooks();
  return addressBooks.map((ab: DAVAddressBook) => ({
    url: ab.url,
    displayName: ab.displayName ?? "Unnamed",
    ctag: ab.ctag,
    description: (ab as any).addressBookDescription,
  }));
};

/**
 * Fetch contacts from an address book
 */
export const fetchContacts = async (
  client: DAVClient,
  addressBook: DAVAddressBook
): Promise<ContactInfo[]> => {
  const vcards = await client.fetchVCards({ addressBook });

  const contacts: ContactInfo[] = [];
  for (const vcard of vcards) {
    if (vcard.data) {
      const contact = parseVCard(vcard.data, vcard.url);
      if (contact) {
        contacts.push(contact);
      }
    }
  }

  return contacts;
};

/**
 * Search contacts by name or email
 */
export const searchContacts = (
  contacts: ContactInfo[],
  query: string
): ContactInfo[] => {
  const lowerQuery = query.toLowerCase();
  return contacts.filter((contact) => {
    // Search in name
    if (contact.fullName.toLowerCase().includes(lowerQuery)) {
      return true;
    }
    // Search in emails
    if (contact.emails.some((e) => e.value.toLowerCase().includes(lowerQuery))) {
      return true;
    }
    // Search in organization
    if (contact.organization?.toLowerCase().includes(lowerQuery)) {
      return true;
    }
    return false;
  });
};
