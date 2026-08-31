const axios = require('axios');

/**
 * Fetch lead details from Sierra Interactive API if only lead ID is provided.
 * Base URL: https://api.sierrainteractivedev.com
 */
async function fetchLeadFromSierra(leadId) {
  const apiKey = process.env.SIERRA_API_KEY;
  const originatingSystem = process.env.SIERRA_ORIGINATING_SYSTEM || 'ThanksIoIntegration';

  if (!apiKey || apiKey === 'your_sierra_api_key_here') {
    throw new Error('SIERRA_API_KEY is not configured in environment variables.');
  }

  const url = `https://api.sierrainteractivedev.com/leads/get/${leadId}`;
  
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
 * Extract and normalize contact data from Sierra Interactive webhook or API payload.
 * Extract 9 required fields:
 * - first_name
 * - last_name
 * - email
 * - phone
 * - street_address
 * - city
 * - state
 * - zip
 * - anniversary_date
 */
function extractContactDetails(payload) {
  const data = payload?.data || payload?.lead || payload || {};

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

  // Address components
  const addressObj = data.primaryAddress || data.addressDetails || data.address || {};
  let streetAddress = '';
  let city = '';
  let state = '';
  let zip = '';

  if (typeof addressObj === 'string') {
    streetAddress = addressObj;
    city = data.city || '';
    state = data.state || data.province || '';
    zip = data.zipCode || data.zip || data.postalCode || '';
  } else {
    streetAddress = addressObj.street || addressObj.streetAddress || addressObj.address || addressObj.line1 || data.street_address || data.address || '';
    city = addressObj.city || data.city || '';
    state = addressObj.state || addressObj.province || data.state || '';
    zip = addressObj.zipCode || addressObj.zip || addressObj.postalCode || data.zip || data.zipCode || '';
  }

  // Anniversary Date
  // Check common Sierra anniversary field names: homeAnniversaryDate, anniversaryDate, closeAnniversaryDate, customFields
  let anniversaryDate = data.homeAnniversaryDate || 
                        data.anniversaryDate || 
                        data.closeAnniversaryDate || 
                        data.anniversary || 
                        '';

  if (!anniversaryDate && data.customFields) {
    if (Array.isArray(data.customFields)) {
      const match = data.customFields.find(cf => 
        /anniversary/i.test(cf.name || cf.key || '')
      );
      if (match) anniversaryDate = match.value;
    } else if (typeof data.customFields === 'object') {
      const keys = Object.keys(data.customFields);
      const matchKey = keys.find(k => /anniversary/i.test(k));
      if (matchKey) anniversaryDate = data.customFields[matchKey];
    }
  }

  // Formatting date string if present
  if (anniversaryDate) {
    try {
      const parsedDate = new Date(anniversaryDate);
      if (!isNaN(parsedDate.getTime())) {
        anniversaryDate = parsedDate.toISOString().split('T')[0]; // YYYY-MM-DD
      }
    } catch (_) {
      // keep original string if parsing fails
    }
  }

  // Tags attached
  const tags = data.tags || payload.tags || payload.tag || [];
  const tagList = Array.isArray(tags) 
    ? tags.map(t => typeof t === 'string' ? t : (t.name || t.tagName || ''))
    : (typeof tags === 'string' ? [tags] : []);

  return {
    sierraId: data.id || data.leadId || payload.leadId || null,
    first_name: firstName.trim(),
    last_name: lastName.trim(),
    email: email.trim(),
    phone: phone.trim(),
    street_address: streetAddress.trim(),
    city: city.trim(),
    state: state.trim(),
    zip: zip.trim(),
    anniversary_date: anniversaryDate ? String(anniversaryDate).trim() : '',
    tags: tagList
  };
}

module.exports = {
  fetchLeadFromSierra,
  extractContactDetails
};
