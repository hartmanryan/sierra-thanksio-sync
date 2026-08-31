require('dotenv').config();
const express = require('express');
const { extractContactDetails, fetchLeadFromSierra } = require('./sierraService');
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
 * Webhook endpoint for Sierra Interactive tag events
 * POST /webhook/sierra-tag
 */
app.post('/webhook/sierra-tag', async (req, res) => {
  console.log(`\n[Webhook Received] ${new Date().toISOString()}`);
  
  try {
    const payload = req.body;
    let contact = extractContactDetails(payload);

    // If tag filtering is enabled, verify tag
    const configuredTag = process.env.TRIGGER_TAG;
    if (configuredTag && configuredTag.toUpperCase() !== 'ANY') {
      const addedTag = payload.tag || payload.tagName || payload.eventData?.tag || '';
      const hasMatchingTag = contact.tags.some(t => t.toLowerCase() === configuredTag.toLowerCase()) || 
                             (typeof addedTag === 'string' && addedTag.toLowerCase() === configuredTag.toLowerCase());

      if (!hasMatchingTag) {
        console.log(`[Tag Filter] Skipped contact ${contact.first_name} ${contact.last_name}. Tag '${configuredTag}' not found in contact tags:`, contact.tags);
        return res.status(200).json({
          status: 'skipped',
          reason: `Tag '${configuredTag}' was not found on contact.`
        });
      }
    }

    // If address or key fields are missing from initial webhook payload, fetch full lead record from Sierra API
    const isMissingFields = !contact.street_address || !contact.city || !contact.email || !contact.phone;
    if (isMissingFields && contact.sierraId) {
      console.log(`[Sierra API] Contact payload incomplete. Fetching full lead profile for ID: ${contact.sierraId}...`);
      try {
        const fullLeadPayload = await fetchLeadFromSierra(contact.sierraId);
        contact = extractContactDetails(fullLeadPayload);
      } catch (fetchErr) {
        console.warn(`[Sierra Warning] Could not fetch extended lead profile: ${fetchErr.message}`);
      }
    }

    console.log('[Contact Extracted Successfully]:');
    console.table({
      'First Name': contact.first_name || '(N/A)',
      'Last Name': contact.last_name || '(N/A)',
      'Email': contact.email || '(N/A)',
      'Phone': contact.phone || '(N/A)',
      'Street Address': contact.street_address || '(N/A)',
      'City': contact.city || '(N/A)',
      'State': contact.state || '(N/A)',
      'Zip': contact.zip || '(N/A)',
      'Anniversary Date': contact.anniversary_date || '(N/A)'
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
