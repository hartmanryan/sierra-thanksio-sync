require('dotenv').config();
const express = require('express');
const { extractContactDetails, fetchLeadFromSierra, findAnniversaryInPayload, leadCustomFieldCache } = require('./sierraService');
const { sendContactToThanksIo } = require('./thanksService');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    config: {
      triggerTag: process.env.TRIGGER_TAG || 'ANY',
      sierraConfigured: Boolean(process.env.SIERRA_API_KEY && process.env.SIERRA_API_KEY !== 'your_sierra_api_key_here'),
      thanksIoConfigured: Boolean(process.env.THANKS_IO_API_TOKEN && process.env.THANKS_IO_API_TOKEN !== 'your_thanks_io_personal_access_token'),
      testMode: process.env.THANKS_IO_TEST_MODE === 'true'
    }
  });
});

/**
 * Webhook endpoint for Sierra Interactive events (LeadTagAdded, LeadDetailsChanged)
 * POST /webhook/sierra-tag
 */
app.post('/webhook/sierra-tag', async (req, res) => {
  console.log(`\n=================================================`);
  console.log(`[Webhook Received] ${new Date().toISOString()}`);
  console.log('[Raw Incoming Payload]:', JSON.stringify(req.body, null, 2));

  try {
    const payload = req.body;
    let initialContact = extractContactDetails(payload);
    let contact = { ...initialContact };

    // 1. Check if payload is a LeadDetailsChanged event updating Home Anniv.
    const rawAnniv = findAnniversaryInPayload(payload, payload.data || {});
    if (contact.sierraId && rawAnniv) {
      console.log(`[Custom Field Captured] Lead ID ${contact.sierraId} 'Home Anniv.': ${rawAnniv}`);
      leadCustomFieldCache.set(String(contact.sierraId), rawAnniv);
    }

    // 2. Fetch full lead profile from Sierra API using query string parameters for complete details
    if (contact.sierraId) {
      console.log(`[Sierra API] Fetching complete profile for Lead ID: ${contact.sierraId}...`);
      try {
        const fullLeadPayload = await fetchLeadFromSierra(contact.sierraId);
        const fullContact = extractContactDetails(fullLeadPayload);

        // Merge details: preserve any custom 'Home Anniv.' date captured from payload or cache
        const cachedAnniv = leadCustomFieldCache.get(String(contact.sierraId)) || '';
        contact = {
          ...fullContact,
          sierraId: contact.sierraId,
          anniversary_date: initialContact.anniversary_date || fullContact.anniversary_date || cachedAnniv || '',
          assigned_agent: fullContact.assigned_agent || initialContact.assigned_agent || '',
          tags: Array.from(new Set([...initialContact.tags, ...fullContact.tags]))
        };
      } catch (fetchErr) {
        console.warn(`[Sierra Warning] Could not fetch extended lead profile: ${fetchErr.message}`);
      }
    }

    // Direct tag fields from payload
    const payloadDirectTag = payload.tag || payload.tagName || payload.Tag || payload.tag_name || payload.data?.tag || payload.data?.tagName || '';
    if (payloadDirectTag && !contact.tags.includes(payloadDirectTag)) {
      contact.tags.push(payloadDirectTag);
    }

    // If eventType is LeadDetailsChanged and tag filtering is active, only proceed if tagged
    const eventType = payload.eventType || payload.event_type || '';
    const configuredTag = process.env.TRIGGER_TAG;
    if (configuredTag && configuredTag.trim() !== '' && configuredTag.toUpperCase() !== 'ANY') {
      const targetLower = configuredTag.trim().toLowerCase();
      const hasMatchingTag = contact.tags.some(t => typeof t === 'string' && t.trim().toLowerCase() === targetLower);

      if (!hasMatchingTag) {
        console.log(`[Tag Filter] Skipped Lead ID ${contact.sierraId || 'N/A'} (event: ${eventType}). Tag '${configuredTag}' not found in contact tags:`, contact.tags);
        return res.status(200).json({
          status: 'skipped',
          reason: `Tag '${configuredTag}' was not found on contact. Found tags: ${JSON.stringify(contact.tags)}`
        });
      }
    }

    console.log('[Contact Details Ready for Thanks.io]:');
    console.table({
      'Lead ID': contact.sierraId || '(N/A)',
      'First Name': contact.first_name || '(N/A)',
      'Last Name': contact.last_name || '(N/A)',
      'Email': contact.email || '(N/A)',
      'Phone': contact.phone || '(N/A)',
      'Street Address': contact.street_address || '(N/A)',
      'City': contact.city || '(N/A)',
      'State': contact.state || '(N/A)',
      'Zip': contact.zip || '(N/A)',
      'Assigned Agent (custom1)': contact.assigned_agent || '(N/A)',
      'Anniversary Date (dob)': contact.anniversary_date || '(N/A)',
      'Tags': contact.tags.join(', ')
    });

    // Send recipient details to Thanks.io
    const result = await sendContactToThanksIo(contact);

    return res.status(200).json({
      status: 'success',
      message: 'Contact successfully processed and sent to Thanks.io.',
      contact,
      thanksIoResult: result
    });

  } catch (err) {
    console.error('[Webhook Processing Error]:', err.message);
    return res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` Sierra Interactive to Thanks.io Webhook Listener `);
    console.log(` Server running on http://localhost:${PORT}`);
    console.log(` Webhook URL: http://localhost:${PORT}/webhook/sierra-tag`);
    console.log(` Health URL:  http://localhost:${PORT}/health`);
    console.log(`=================================================`);
  });
}

module.exports = app;
