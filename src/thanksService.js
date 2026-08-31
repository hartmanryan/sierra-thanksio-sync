const axios = require('axios');

/**
 * Send contact details to Thanks.io API.
 * First checks for and removes any old matching recipient (by First & Last Name, Email, or Street Address),
 * then creates the fresh recipient record with updated address, dob (Anniversary), and custom1 (Agent).
 */
async function sendContactToThanksIo(contact) {
  const token = process.env.THANKS_IO_API_TOKEN;
  const listId = process.env.THANKS_IO_MAILING_LIST_ID;
  const isTestMode = process.env.THANKS_IO_TEST_MODE === 'true';

  if (!token || token === 'your_thanks_io_personal_access_token') {
    if (isTestMode) {
      console.log('[Thanks.io Test Mode] Token not set. Simulating successful send with contact:');
      console.dir(contact, { depth: null });
      return {
        success: true,
        testMode: true,
        message: 'Test mode delivery simulated successfully.',
        recipient: contact
      };
    }
    throw new Error('THANKS_IO_API_TOKEN is not configured in environment variables.');
  }

  // 1. Search for and delete any old recipient matching First & Last Name, Email, or Address
  await removeExistingRecipientIfAny(contact, token, listId);

  // 2. Construct payload adhering to Thanks.io v2 API specs:
  // - dob/birthdate: mapped to Sierra Anniversary Date
  // - custom1: mapped to Sierra Assigned Agent
  const payload = {
    first_name: contact.first_name,
    last_name: contact.last_name,
    name: `${contact.first_name} ${contact.last_name}`.trim(),
    email: contact.email,
    phone: contact.phone,
    address: contact.street_address,
    city: contact.city,
    province: contact.state,
    state: contact.state,
    postal_code: contact.zip,
    zip: contact.zip,
    dob: contact.anniversary_date || null,
    birthdate: contact.anniversary_date || null,
    anniversary: contact.anniversary_date || null,
    ...(listId && listId !== 'your_thanks_io_mailing_list_id' ? { mailing_list_id: listId, list_id: listId } : {}),
    custom_fields: {
      anniversary_date: contact.anniversary_date,
      assigned_agent: contact.assigned_agent,
      email: contact.email,
      phone: contact.phone
    },
    custom1: contact.assigned_agent || ''
  };

  if (isTestMode) {
    console.log('[Thanks.io Test Mode Enabled] Payload to send:');
    console.dir(payload, { depth: null });
  }

  try {
    let response = await axios.post('https://api.thanks.io/api/v2/recipients', payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    // Handle case where API returns HTTP 200 but response body indicates duplicate address failure
    if (response.data && response.data.failure && String(response.data.errors || response.data.error).includes('already on this mailing list')) {
      console.log('[Thanks.io Duplicate Encountered] Force clearing existing recipient record and retrying...');
      await removeExistingRecipientIfAny(contact, token, listId);
      
      // Retry POST recipient
      response = await axios.post('https://api.thanks.io/api/v2/recipients', payload, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
    }

    console.log(`[Thanks.io Success] Recipient created/updated. ID: ${response.data?.id || response.data?.data?.id || 'OK'}`);
    return {
      success: true,
      data: response.data
    };
  } catch (err) {
    console.error('[Thanks.io API Error] Failed to create recipient:', err.response?.data || err.message);
    throw new Error(`Thanks.io API request failed: ${JSON.stringify(err.response?.data || err.message)}`);
  }
}

/**
 * Search and remove existing recipient(s) by matching first & last name, email, or address
 */
async function removeExistingRecipientIfAny(contact, token, listId) {
  if (!token) return;

  try {
    const fullNameLower = `${contact.first_name} ${contact.last_name}`.trim().toLowerCase();
    const emailLower = (contact.email || '').trim().toLowerCase();
    const streetLower = (contact.street_address || '').trim().toLowerCase();

    // Search endpoints to query list recipients
    const searchUrls = [];
    if (listId && listId !== 'your_thanks_io_mailing_list_id') {
      searchUrls.push(`https://api.thanks.io/api/v2/recipients?mailing_list_id=${listId}&limit=200`);
      searchUrls.push(`https://api.thanks.io/api/v2/mailing-lists/${listId}/recipients?limit=200`);
    } else {
      searchUrls.push(`https://api.thanks.io/api/v2/recipients?limit=200`);
    }

    let records = [];
    for (const url of searchUrls) {
      try {
        const res = await axios.get(url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        });
        const found = res.data?.data || res.data?.recipients || (Array.isArray(res.data) ? res.data : []);
        if (Array.isArray(found) && found.length > 0) {
          records = found;
          break;
        }
      } catch (_) {}
    }

    const matches = records.filter(r => {
      const rName = (r.name || `${r.first_name || ''} ${r.last_name || ''}`).trim().toLowerCase();
      const rEmail = (r.email || '').trim().toLowerCase();
      const rAddress = (r.address || r.street_address || '').trim().toLowerCase();

      const nameMatch = fullNameLower.length > 1 && rName === fullNameLower;
      const emailMatch = emailLower.length > 3 && rEmail === emailLower;
      const addressMatch = streetLower.length > 3 && rAddress === streetLower;

      return nameMatch || emailMatch || addressMatch;
    });

    if (matches.length > 0) {
      console.log(`[Thanks.io Pre-Check] Found ${matches.length} old matching recipient(s) for '${contact.first_name} ${contact.last_name}'. Deleting old entry...`);
      for (const m of matches) {
        const recId = m.id || m.recipient_id;
        if (recId) {
          const deleteEndpoints = [
            `https://api.thanks.io/api/v2/recipients/${recId}`,
            listId ? `https://api.thanks.io/api/v2/mailing-lists/${listId}/recipients/${recId}` : null
          ].filter(Boolean);

          for (const delUrl of deleteEndpoints) {
            try {
              await axios.delete(delUrl, {
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Accept': 'application/json'
                }
              });
              console.log(`[Thanks.io] Successfully removed old recipient ID ${recId} via ${delUrl}`);
              break;
            } catch (_) {}
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[Thanks.io Warning] Pre-creation search for existing recipient encountered issue:`, err.message);
  }
}

module.exports = {
  sendContactToThanksIo
};
