const axios = require('axios');

// In-memory cache to store custom field changes (e.g. Home Anniv.) by Sierra Lead ID
const leadCustomFieldCache = new Map();

/**
 * Fetch lead details from Sierra Interactive API using query parameters to include all tags and lead data.
 * Endpoint: GET https://api.sierrainteractivedev.com/leads/get/{leadId}?includeTags=true
 */
async function fetchLeadFromSierra(leadId) {
  const apiKey = process.env.SIERRA_API_KEY;
  const originatingSystem = process.env.SIERRA_ORIGINATING_SYSTEM || 'ThanksIoIntegration';

  if (!apiKey || apiKey === 'your_sierra_api_key_here') {
    throw new Error('SIERRA_API_KEY is not configured in environment variables.');
  }

  const url = `https://api.sierrainteractivedev.com/leads/get/${leadId}?includeTags=true&includeActionPlans=true`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Sierra-ApiKey': apiKey,
        'Sierra-OriginatingSystemName': originatingSystem,
        'Accept': 'application/json'
      }
    });

    return response.data?.data || response.data;
  } catch (err) {
    console.error(`[Sierra API Error] Failed to fetch lead ${leadId}:`, err.response?.data || err.message);
    throw new Error(`Sierra API request failed: ${err.message}`);
  }
}

/**
 * Helper to scan and extract anniversary date specifically from 'Home Anniv.', 'Home Anniv',
 * 'homeAnniversaryDate', 'birthDate', changes array, or customFields matching /anniv|anniversary|birth/i.
 */
function findAnniversaryInPayload(payload, data) {
  // 1. Direct property checks on lead object or payload
  const direct = data?.['Home Anniv.'] || data?.['Home Anniv'] || data?.homeAnniv || data?.home_anniv ||
                 data?.homeAnniversaryDate || data?.homeAnniversary || data?.birthDate || data?.birthdate ||
                 data?.anniversaryDate || data?.closeAnniversaryDate || data?.anniversary ||
                 payload?.['Home Anniv.'] || payload?.['Home Anniv'] || payload?.homeAnniv || payload?.home_anniv ||
                 payload?.homeAnniversaryDate || payload?.homeAnniversary || payload?.data?.['Home Anniv.'] || payload?.data?.['Home Anniv'];
  if (direct) return direct;

  // 2. Check changes array in LeadDetailsChanged webhook payload
  const changes = payload?.data?.changes || payload?.changes;
  if (Array.isArray(changes)) {
    const changeMatch = changes.find(c => /anniv|anniversary|birth/i.test(c.key || c.name || c.label || ''));
    if (changeMatch && (changeMatch.value || changeMatch.val || changeMatch.newValue)) {
      return changeMatch.value || changeMatch.val || changeMatch.newValue;
    }
  }

  // 3. Check customFields array or object
  const customFields = data?.customFields || payload?.customFields || data?.custom_fields || payload?.custom_fields || payload?.data?.customFields;
  if (Array.isArray(customFields)) {
    const match = customFields.find(cf => /anniv|anniversary|birth/i.test(cf.name || cf.key || cf.label || ''));
    if (match) return match.value || match.val || match.defaultValue;
  } else if (customFields && typeof customFields === 'object') {
    const keys = Object.keys(customFields);
    const matchKey = keys.find(k => /anniv|anniversary|birth/i.test(k));
    if (matchKey) return customFields[matchKey];
  }

  return '';
}

/**
 * Extract and normalize contact data from Sierra Interactive webhook or API payload.
 */
function extractContactDetails(payload) {
  const data = payload?.data || payload?.lead || payload || {};

  // Extract Sierra Lead ID from resourceList array or leadId fields
  let sierraId = null;
  if (Array.isArray(payload?.resourceList) && payload.resourceList.length > 0) {
    sierraId = payload.resourceList[0];
  } else if (Array.isArray(payload?.resource_list) && payload.resource_list.length > 0) {
    sierraId = payload.resource_list[0];
  } else {
    sierraId = payload?.leadId || payload?.lead_id || payload?.LeadId || payload?.id || payload?.entityId ||
               data?.id || data?.leadId || data?.lead_id || null;
  }

  // First Name & Last Name
  let firstName = data.firstName || data.first_name || '';
  let lastName = data.lastName || data.last_name || '';

  if (!firstName && !lastName && data.name) {
    const parts = data.name.trim().split(/\s+/);
    firstName = parts[0] || '';
    lastName = parts.slice(1).join(' ') || '';
  }

  // Email
  let email = '';
  if (typeof data.email === 'string') {
    email = data.email;
  } else if (Array.isArray(data.emails) && data.emails.length > 0) {
    const primary = data.emails.find(e => e.isPrimary || e.primary) || data.emails[0];
    email = typeof primary === 'string' ? primary : (primary?.address || primary?.email || '');
  } else if (data.emails && typeof data.emails === 'object') {
    email = data.emails.primary || data.emails.address || '';
  }

  // Phone
  let phone = '';
  if (typeof data.phone === 'string') {
    phone = data.phone;
  } else if (Array.isArray(data.phones) && data.phones.length > 0) {
    const primary = data.phones.find(p => p.isPrimary || p.primary) || data.phones[0];
    phone = typeof primary === 'string' ? primary : (primary?.number || primary?.phone || '');
  } else if (data.cellPhone || data.mobilePhone || data.workPhone) {
    phone = data.cellPhone || data.mobilePhone || data.workPhone || '';
  }

  // Assigned Agent (Sierra assignedTo object)
  let assignedAgent = '';
  if (data.assignedTo && typeof data.assignedTo === 'object') {
    const first = data.assignedTo.agentUserFirstName || '';
    const last = data.assignedTo.agentUserLastName || '';
    assignedAgent = `${first} ${last}`.trim() || data.assignedTo.agentUserEmail || '';
  }

  // Address components
  const addressObj = data.primaryAddress || data.addressDetails || (typeof data.address === 'object' ? data.address : {});
  let streetAddress = data.streetAddress || data.street_address || (typeof data.address === 'string' ? data.address : '');
  let city = data.city || '';
  let state = data.state || data.province || '';
  let zip = data.zipCode || data.zip || data.postalCode || '';

  if (!streetAddress && addressObj) {
    streetAddress = addressObj.street || addressObj.streetAddress || addressObj.address || addressObj.line1 || '';
    if (!city) city = addressObj.city || '';
    if (!state) state = addressObj.state || addressObj.province || '';
    if (!zip) zip = addressObj.zipCode || addressObj.zip || addressObj.postalCode || '';
  }

  // Anniversary Date / Birthdate parsing
  let rawAnniversaryDate = findAnniversaryInPayload(payload, data);

  // Cache extracted custom anniversary date by leadId if found
  if (sierraId && rawAnniversaryDate) {
    leadCustomFieldCache.set(String(sierraId), rawAnniversaryDate);
  } else if (sierraId && !rawAnniversaryDate && leadCustomFieldCache.has(String(sierraId))) {
    rawAnniversaryDate = leadCustomFieldCache.get(String(sierraId));
  }

  let anniversaryDate = rawAnniversaryDate ? String(rawAnniversaryDate).trim() : '';

  if (anniversaryDate) {
    try {
      const parsedDate = new Date(anniversaryDate);
      if (!isNaN(parsedDate.getTime())) {
        anniversaryDate = parsedDate.toISOString().split('T')[0]; // YYYY-MM-DD
      }
    } catch (_) {}
  }

  // Tags attached
  const rawTags = data.tags || payload?.data?.tag || payload?.tags || payload?.tag || payload?.tagName || payload?.Tag || payload?.tag_name || [];
  const tagList = Array.isArray(rawTags) 
    ? rawTags.map(t => typeof t === 'string' ? t : (t.name || t.tagName || ''))
    : (typeof rawTags === 'string' ? [rawTags] : []);

  return {
    sierraId: sierraId ? String(sierraId).trim() : null,
    first_name: firstName.trim(),
    last_name: lastName.trim(),
    email: email.trim(),
    phone: phone.trim(),
    street_address: streetAddress.trim(),
    city: city.trim(),
    state: state.trim(),
    zip: zip.trim(),
    assigned_agent: assignedAgent,
    anniversary_date: anniversaryDate,
    raw_anniversary: rawAnniversaryDate,
    tags: tagList
  };
}

module.exports = {
  fetchLeadFromSierra,
  extractContactDetails,
  findAnniversaryInPayload,
  leadCustomFieldCache
};
