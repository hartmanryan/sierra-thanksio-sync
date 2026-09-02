const axios = require('axios');

/**
 * Send contact details to Thanks.io API.
 * First searches explicitly for old entries matching First & Last Name, Email, or Address using Thanks.io search endpoints,
 * deletes any matching old recipients, and creates/updates the recipient record with updated address, dob (Anniversary), and custom1 (Agent).
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

  // 1. Search for and delete/update any old recipient matching First & Last Name, Email, or Address
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
      console.log('[Thanks.io Duplicate Address Encountered] Force clearing existing recipient record and retrying...');
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
 * Search Thanks.io explicitly using search parameters for name, email, and address,
 * then delete all existing matching recipients before creating the new record.
 */
async function removeExistingRecipientIfAny(contact, token, listId) {
  if (!token) return;

  const fullName = `${contact.first_name} ${contact.last_name}`.trim();
  const email = (contact.email || '').trim();
  const address = (contact.street_address || '').trim();

  const searchQueries = Array.from(new Set([fullName, email, address].filter(q => q && q.length > 2)));
  const foundRecipientsMap = new Map();

  for (const query of searchQueries) {
    const searchUrls = [
      `https://api.thanks.io/api/v2/recipients?search=${encodeURIComponent(query)}`,
      listId && listId !== 'your_thanks_io_mailing_list_id' ? `https://api.thanks.io/api/v2/recipients?mailing_list_id=${listId}&search=${encodeURIComponent(query)}` : null,
      listId && listId !== 'your_thanks_io_mailing_list_id' ? `https://api.thanks.io/api/v2/mailing-lists/${listId}/recipients?search=${encodeURIComponent(query)}` : null
    ].filter(Boolean);

    for (const url of searchUrls) {
      try {
        const res = await axios.get(url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        });

        const records = res.data?.data || res.data?.recipients || (Array.isArray(res.data) ? res.data : []);
        if (Array.isArray(records)) {
          for (const r of records) {
            const recId = r.id || r.recipient_id;
            if (recId) {
              foundRecipientsMap.set(String(recId), r);
            }
          }
        }
      } catch (err) {
        console.warn(`[Thanks.io Search Warning] Query '${query}' on ${url} failed:`, err.message);
      }
    }
  }

  // Delete/update all matching recipient records found
  if (foundRecipientsMap.size > 0) {
    console.log(`[Thanks.io Pre-Check] Found ${foundRecipientsMap.size} existing matching recipient(s) for '${fullName}'. Removing old entries...`);
    for (const [recId, m] of foundRecipientsMap.entries()) {
      const deleteEndpoints = [
        `https://api.thanks.io/api/v2/recipients/${recId}`,
        listId && listId !== 'your_thanks_io_mailing_list_id' ? `https://api.thanks.io/api/v2/mailing-lists/${listId}/recipients/${recId}` : null
      ].filter(Boolean);

      let deleted = false;
      for (const delUrl of deleteEndpoints) {
        try {
          await axios.delete(delUrl, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json'
            }
          });
          console.log(`[Thanks.io Success] Deleted old recipient ID ${recId} (${m.name || m.email || m.address}) via ${delUrl}`);
          deleted = true;
          break;
        } catch (delErr) {
          console.warn(`[Thanks.io Warning] Delete attempt on ${delUrl} failed:`, delErr.message);
        }
      }

      // Fallback: If HTTP DELETE is not supported by list endpoint, call PUT to overwrite existing recipient details directly
      if (!deleted) {
        try {
          await axios.put(`https://api.thanks.io/api/v2/recipients/${recId}`, {
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
            custom1: contact.assigned_agent || ''
          }, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            }
          });
          console.log(`[Thanks.io Success] Updated existing recipient ID ${recId} directly via PUT.`);
        } catch (_) {}
      }
    }
  }
}

module.exports = {
  sendContactToThanksIo
};
