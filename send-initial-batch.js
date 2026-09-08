// Usage: node scripts/send-initial-batch.js [batch_size]
//
// Sends the first-touch reactivation SMS to leads with status = 'new'.
// Defaults to a batch of 50 at a time to avoid carrier spam-filtering and
// to respect Twilio's messaging rate limits on a new number.
//
// Run this repeatedly (e.g. via cron once daily) to work through a large
// list gradually rather than blasting thousands of texts at once, which
// is both a deliverability risk and a compliance red flag.

require('dotenv').config();
const twilio = require('twilio');
const { getLeadsByStatus, updateLeadStatus, logMessage } = require('../db');
const { firstTouchMessage } = require('../chatbot');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const BATCH_SIZE = Number(process.argv[2]) || 50;

async function run() {
  const leads = getLeadsByStatus('new', BATCH_SIZE);
  console.log(`Sending first-touch message to ${leads.length} leads...`);

  for (const lead of leads) {
    const message = firstTouchMessage(lead);
    try {
      await client.messages.create({ to: lead.phone, from: FROM_NUMBER, body: message });
      logMessage(lead.id, 'outbound', message);
      updateLeadStatus(lead.id, 'contacted', { sequence_step: 1 });
      console.log(`✓ Sent to ${lead.phone}`);
    } catch (err) {
      console.error(`✗ Failed to send to ${lead.phone}: ${err.message}`);
    }
    // Small delay to stay well under Twilio's rate limits
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log('Batch complete.');
  process.exit(0);
}

run();
