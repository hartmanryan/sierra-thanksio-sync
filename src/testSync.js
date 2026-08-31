/**
 * Test runner script to simulate receiving a tagged contact from Sierra Interactive
 * and pushing all 9 required fields to Thanks.io.
 */
require('dotenv').config();
const { extractContactDetails } = require('./sierraService');
const { sendContactToThanksIo } = require('./thanksService');

// Mock lead webhook payload representing a tagged contact in Sierra Interactive
const mockSierraPayload = {
  eventId: 'evt_987654321',
  eventType: 'lead_tagged',
  tag: 'Thanks.io',
  lead: {
    id: 'sierra_lead_102938',
    firstName: 'Jane',
    lastName: 'Dallaire',
    email: 'jane.dallaire@example.com',
    phone: '555-839-2001',
    tags: ['Thanks.io', 'Past Client', 'Anniversary List'],
    primaryAddress: {
      street: '742 Evergreen Terrace',
      city: 'Springfield',
      state: 'OR',
      zipCode: '97477'
    },
    homeAnniversaryDate: '2024-09-15',
    customFields: [
      { name: 'Anniversary Date', value: '2024-09-15' }
    ]
  }
};

async function runTestSync() {
  console.log('----------------------------------------------------');
  console.log('Running Sierra Interactive -> Thanks.io Test Sync');
  console.log('----------------------------------------------------\n');

  console.log('[Step 1] Parsing Sierra Interactive Lead Payload...');
  const contact = extractContactDetails(mockSierraPayload);

  console.log('\n[Extracted Contact Fields]:');
  console.log(`- First Name:       ${contact.first_name}`);
  console.log(`- Last Name:        ${contact.last_name}`);
  console.log(`- Email:            ${contact.email}`);
  console.log(`- Phone:            ${contact.phone}`);
  console.log(`- Street Address:   ${contact.street_address}`);
  console.log(`- City:             ${contact.city}`);
  console.log(`- State:            ${contact.state}`);
  console.log(`- Zip:              ${contact.zip}`);
  console.log(`- Anniversary Date: ${contact.anniversary_date}`);
  console.log(`- Attached Tags:    ${contact.tags.join(', ')}`);

  // Validate all 9 required fields are present
  const requiredKeys = ['first_name', 'last_name', 'email', 'phone', 'street_address', 'city', 'state', 'zip', 'anniversary_date'];
  const missingKeys = requiredKeys.filter(key => !contact[key]);

  if (missingKeys.length > 0) {
    console.error(`\n[Test Failed] Missing required fields: ${missingKeys.join(', ')}`);
    process.exit(1);
  }

  console.log('\n[Step 2] Sending Contact to Thanks.io...');
  const result = await sendContactToThanksIo(contact);

  console.log('\n----------------------------------------------------');
  console.log('Test Sync Result:', JSON.stringify(result, null, 2));
  console.log('----------------------------------------------------');
  console.log('ALL 9 FIELDS SUCCESSFULLY VERIFIED & DISPATCHED!');
}

runTestSync().catch(err => {
  console.error('\n[Test Error]:', err);
  process.exit(1);
});
