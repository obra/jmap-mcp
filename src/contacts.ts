import { DAVClient, DAVAddressBook, DAVVCard } from "tsdav";
import ICAL from "ical.js";

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

export interface ContactUrl {
  type?: string;
  value: string;
}

export interface ContactAddress {
  type?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface ContactInfo {
  uid: string;
  url: string;
  fullName: string;
  emails: ContactEmail[];
  phones: ContactPhone[];
  organization?: string;
  title?: string;
  birthday?: string;
  notes?: string;
  urls?: ContactUrl[];
  addresses?: ContactAddress[];
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
// vCard Parsing (using ical.js)
// =============================================================================

/**
 * Parse vCard content and extract contact details using ical.js
 * Handles vCard 3.0 and 4.0 formats
 */
export const parseVCard = (
  vcardContent: string,
  url: string
): ContactInfo | undefined => {
  // Check for valid structure
  if (!vcardContent.includes("BEGIN:VCARD") || !vcardContent.includes("END:VCARD")) {
    return undefined;
  }

  try {
    const jcalData = ICAL.parse(vcardContent);
    const vcard = new ICAL.Component(jcalData);

    // Get UID - required
    const uid = vcard.getFirstPropertyValue("uid");
    if (!uid) {
      return undefined;
    }

    // Get FN (Full Name) - required
    const fullName = vcard.getFirstPropertyValue("fn");
    if (!fullName) {
      return undefined;
    }

    // Build result
    const result: ContactInfo = {
      uid: String(uid),
      url,
      fullName: String(fullName),
      emails: [],
      phones: [],
    };

    // Parse organization
    const org = vcard.getFirstPropertyValue("org");
    if (org) {
      result.organization = String(org);
    }

    // Parse title
    const title = vcard.getFirstPropertyValue("title");
    if (title) {
      result.title = String(title);
    }

    // Parse birthday
    const bday = vcard.getFirstPropertyValue("bday");
    if (bday) {
      // ical.js may return various formats, normalize to YYYY-MM-DD
      result.birthday = String(bday);
    }

    // Parse notes
    const note = vcard.getFirstPropertyValue("note");
    if (note) {
      result.notes = String(note);
    }

    // Parse emails with types
    const emailProps = vcard.getAllProperties("email");
    result.emails = emailProps.map((prop: any) => {
      const value = prop.getFirstValue();
      const type = prop.getParameter("type");
      return {
        type: type ? String(type).toLowerCase() : "other",
        value: String(value),
      };
    });

    // Parse phones with types
    const telProps = vcard.getAllProperties("tel");
    result.phones = telProps.map((prop: any) => {
      const value = prop.getFirstValue();
      const type = prop.getParameter("type");
      return {
        type: type ? String(type).toLowerCase() : "other",
        value: String(value),
      };
    });

    // Parse URLs
    const urlProps = vcard.getAllProperties("url");
    if (urlProps.length > 0) {
      result.urls = urlProps.map((prop: any) => {
        const value = prop.getFirstValue();
        const type = prop.getParameter("type");
        return {
          type: type ? String(type).toLowerCase() : undefined,
          value: String(value),
        };
      });
    }

    // Parse addresses
    const adrProps = vcard.getAllProperties("adr");
    if (adrProps.length > 0) {
      result.addresses = adrProps.map((prop: any) => {
        const value = prop.getFirstValue();
        const type = prop.getParameter("type");

        // ADR structure: [PO Box, Extended, Street, City, State, Postal Code, Country]
        // value can be an array or structured value
        let parts: string[] = [];
        if (Array.isArray(value)) {
          parts = value.map((v: any) => String(v ?? ""));
        } else if (typeof value === "object" && value !== null) {
          // Structured value from ical.js
          parts = [
            value.postOfficeBox ?? "",
            value.extendedAddress ?? "",
            value.streetAddress ?? "",
            value.locality ?? "",
            value.region ?? "",
            value.postalCode ?? "",
            value.countryName ?? "",
          ];
        }

        return {
          type: type ? String(type).toLowerCase() : undefined,
          street: parts[2] || undefined,
          city: parts[3] || undefined,
          state: parts[4] || undefined,
          postalCode: parts[5] || undefined,
          country: parts[6] || undefined,
        };
      });
    }

    return result;
  } catch (error) {
    // If ical.js fails to parse, return undefined
    return undefined;
  }
};

// =============================================================================
// vCard Generation (using ical.js)
// =============================================================================

export interface CreateContactParams {
  fullName: string;
  emails?: Array<{ type?: string; value: string }>;
  phones?: Array<{ type?: string; value: string }>;
  organization?: string;
  title?: string;
  notes?: string;
}

/**
 * Generate a unique UID for a new contact
 */
const generateContactUid = (): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}@fastmail-aibo`;
};

/**
 * Create a vCard string for a new contact using ical.js
 */
export const createVCardString = (params: CreateContactParams): { vCardString: string; uid: string } => {
  const uid = generateContactUid();

  // Create VCARD component
  const vcard = new ICAL.Component(["vcard", [], []]);
  vcard.updatePropertyWithValue("version", "3.0");
  vcard.updatePropertyWithValue("uid", uid);
  vcard.updatePropertyWithValue("fn", params.fullName);

  // Add optional fields
  if (params.organization) {
    vcard.updatePropertyWithValue("org", params.organization);
  }
  if (params.title) {
    vcard.updatePropertyWithValue("title", params.title);
  }
  if (params.notes) {
    vcard.updatePropertyWithValue("note", params.notes);
  }

  // Add emails with types
  if (params.emails && params.emails.length > 0) {
    for (const email of params.emails) {
      const prop = new ICAL.Property("email");
      prop.setValue(email.value);
      if (email.type) {
        prop.setParameter("type", email.type.toUpperCase());
      }
      vcard.addProperty(prop);
    }
  }

  // Add phones with types
  if (params.phones && params.phones.length > 0) {
    for (const phone of params.phones) {
      const prop = new ICAL.Property("tel");
      prop.setValue(phone.value);
      if (phone.type) {
        prop.setParameter("type", phone.type.toUpperCase());
      }
      vcard.addProperty(prop);
    }
  }

  return {
    vCardString: vcard.toString(),
    uid,
  };
};

/**
 * Generate vCard filename from UID
 */
export const generateVCardFilename = (uid: string): string => {
  return `${uid}.vcf`;
};

// =============================================================================
// vCard Update (using ical.js)
// =============================================================================

export interface UpdateContactParams {
  fullName?: string;
  emails?: Array<{ type?: string; value: string }>;
  phones?: Array<{ type?: string; value: string }>;
  organization?: string;
  title?: string;
  notes?: string;
}

/**
 * Update an existing vCard string with new values
 * Preserves the UID and other fields not being updated
 * Empty string values clear the field
 * Empty arrays clear the email/phone lists
 */
export const updateVCardString = (
  vCardString: string,
  updates: UpdateContactParams
): string => {
  const jcalData = ICAL.parse(vCardString);
  const vcard = new ICAL.Component(jcalData);

  // Update fullName
  if (updates.fullName !== undefined) {
    vcard.updatePropertyWithValue("fn", updates.fullName);
  }

  // Update organization (empty string clears it)
  if (updates.organization !== undefined) {
    if (updates.organization === "") {
      vcard.removeProperty("org");
    } else {
      vcard.updatePropertyWithValue("org", updates.organization);
    }
  }

  // Update title (empty string clears it)
  if (updates.title !== undefined) {
    if (updates.title === "") {
      vcard.removeProperty("title");
    } else {
      vcard.updatePropertyWithValue("title", updates.title);
    }
  }

  // Update notes (empty string clears it)
  if (updates.notes !== undefined) {
    if (updates.notes === "") {
      vcard.removeProperty("note");
    } else {
      vcard.updatePropertyWithValue("note", updates.notes);
    }
  }

  // Update emails (replace all existing)
  if (updates.emails !== undefined) {
    // Remove all existing email properties
    vcard.removeAllProperties("email");

    // Add new emails
    for (const email of updates.emails) {
      const prop = new ICAL.Property("email");
      prop.setValue(email.value);
      if (email.type) {
        prop.setParameter("type", email.type.toUpperCase());
      }
      vcard.addProperty(prop);
    }
  }

  // Update phones (replace all existing)
  if (updates.phones !== undefined) {
    // Remove all existing tel properties
    vcard.removeAllProperties("tel");

    // Add new phones
    for (const phone of updates.phones) {
      const prop = new ICAL.Property("tel");
      prop.setValue(phone.value);
      if (phone.type) {
        prop.setParameter("type", phone.type.toUpperCase());
      }
      vcard.addProperty(prop);
    }
  }

  return vcard.toString();
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
