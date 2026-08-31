# Sierra Interactive to Thanks.io Tag Integration

Automated integration script and webhook listener that pushes a contact's details from **Sierra Interactive** to **Thanks.io** whenever a contact is tagged.

---

## 📌 Features

Pushes all **9 required fields** to Thanks.io:
1. **First Name** (`first_name`)
2. **Last Name** (`last_name`)
3. **Email** (`email`)
4. **Phone** (`phone`)
5. **Street Address** (`street_address`)
6. **City** (`city`)
7. **State / Province** (`state`)
8. **Zip / Postal Code** (`zip`)
9. **Anniversary Date** (`anniversary_date` / `homeAnniversaryDate` mapped to custom attributes)

---

## 🚀 Quick Setup Instructions

### 1. Environment Configuration
Edit the `.env` file in the project root:

```ini
PORT=3000

# Sierra Interactive API Settings
SIERRA_API_KEY=your_sierra_api_key_here
SIERRA_ORIGINATING_SYSTEM=ThanksIoIntegration

# Specific tag in Sierra Interactive that triggers sending to Thanks.io (e.g. Thanks.io)
TRIGGER_TAG=Thanks.io

# Thanks.io API Settings
THANKS_IO_API_TOKEN=your_thanks_io_personal_access_token
THANKS_IO_MAILING_LIST_ID=your_thanks_io_mailing_list_id

# Set to false when ready for live production sends
THANKS_IO_TEST_MODE=true
```

### 2. Start the Server
Run the webhook server:

```bash
npm start
```

The server runs on `http://localhost:3000`.

### 3. Verify Integration Locally
Run the built-in test runner to verify field parsing and Thanks.io API dispatch:

```bash
npm run test:sync
```

---

## 🔗 Connecting Sierra Interactive Webhooks

1. Log into your **Sierra Interactive Admin Dashboard**.
2. Navigate to **Integrations / API** > **Webhooks**.
3. Create a **Webhook Subscription** pointing to your deployment URL:
   - **Target URL**: `https://your-domain-or-ngrok.com/webhook/sierra-tag`
   - **Event Type**: Lead Tagged / Lead Updated
4. Apply the configured tag (e.g. `Thanks.io`) to any lead in Sierra Interactive.
5. The contact's First Name, Last Name, Email, Phone, Address, City, State, Zip, and Home Anniversary Date will be formatted and pushed directly to Thanks.io!
