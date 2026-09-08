// Usage: node scripts/send-followups.js
//
// Run this daily (via cron or a scheduler) to advance leads through the
// follow-up sequence. Leads that are still "contacted" (no reply) after
// enough days pass get the next message in the sequence; after step 3,
// they're marked "cold" and left alone.
//
// Adjust DAYS_BETWEEN_STEPS to control the cadence.

require('dotenv').config();
const twilio = require('twilio');
const { db, updateLeadStatus, logMessage } = require('../db');
const { followUpMessage } = require('../chatbot');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const DAYS_BETWEEN_STEPS = 3;

async function run() {
  const cutoff = new Date(Date.now() - DAYS_BETWEEN_STEPS * 24 * 60 * 60 * 1000).toISOString();

  const leads = db.prepare(`
    SELECT * FROM leads
    WHERE status = 'contacted'
    AND sequence_step < 3
    AND (last_message_at IS NULL OR last_message_at < ?)
  `).all(cutoff);

  console.log(`${leads.length} leads due for a follow-up message.`);

  for (const lead of leads) {
    const nextStep = lead.sequence_step + 1;
    const message = followUpMessage(lead, nextStep);

    if (!message) {
      // Sequence exhausted, no reply - mark cold
      updateLeadStatus(lead.id, 'cold');
      continue;
    }

    try {
      await client.messages.create({ to: lead.phone, from: FROM_NUMBER, body: message });
      logMessage(lead.id, 'outbound', message);
      updateLeadStatus(lead.id, 'contacted', { sequence_step: nextStep });
      console.log(`✓ Follow-up ${nextStep} sent to ${lead.phone}`);
    } catch (err) {
      console.error(`✗ Failed to send follow-up to ${lead.phone}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log('Follow-up run complete.');
  process.exit(0);
}

run();
