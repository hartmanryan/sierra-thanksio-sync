const axios = require('axios');

/**
 * Send contact details to Thanks.io API.
 * Endpoint: POST https://api.thanks.io/api/v2/recipients
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

  // Construct payload adhering to Thanks.io v2 API specs:
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
    const response = await axios.post('https://api.thanks.io/api/v2/recipients', payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    console.log(`[Thanks.io Success] Recipient created. ID: ${response.data?.id || response.data?.data?.id || 'OK'}`);
    return {
      success: true,
      data: response.data
    };
  } catch (err) {
    console.error('[Thanks.io API Error] Failed to create recipient:', err.response?.data || err.message);
    throw new Error(`Thanks.io API request failed: ${JSON.stringify(err.response?.data || err.message)}`);
  }
}

module.exports = {
  sendContactToThanksIo
};
