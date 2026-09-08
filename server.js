require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const {
  getLeadByPhone,
  updateLeadStatus,
  logMessage,
  getConversationHistory,
  getLeadsByStatus,
  recordDeal,
  getCommissionSummary,
} = require('./db');
const { handleIncomingReply } = require('./chatbot');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER;

async function sendSms(toNumber, body) {
  return twilioClient.messages.create({ to: toNumber, from: FROM_NUMBER, body });
}

// --- Twilio inbound webhook ---
// Set this URL as your Twilio phone number's "A MESSAGE COMES IN" webhook:
// https://your-domain/webhooks/sms
app.post('/webhooks/sms', async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || '').trim();

  const lead = getLeadByPhone(from);
  const twiml = new twilio.twiml.MessagingResponse();

  if (!lead) {
    // Unknown number texted in - don't engage automatically
    console.log(`Inbound SMS from unknown number ${from}: ${body}`);
    return res.type('text/xml').send(twiml.toString());
  }

  logMessage(lead.id, 'inbound', body);

  // Hard opt-out handling, independent of AI classification
  if (/^stop$/i.test(body)) {
    updateLeadStatus(lead.id, 'opted_out');
    twiml.message("You've been unsubscribed and won't receive further messages.");
    return res.type('text/xml').send(twiml.toString());
  }

  try {
    const history = getConversationHistory(lead.id);
    const { intent, reply_text } = await handleIncomingReply(lead, body, history);

    const statusMap = {
      interested: 'hot',
      needs_info: 'replied',
      booked: 'booked',
      not_interested: 'cold',
      opted_out: 'opted_out',
      unclear: 'replied',
    };
    updateLeadStatus(lead.id, statusMap[intent] || 'replied');

    if (reply_text) {
      logMessage(lead.id, 'outbound', reply_text);
      twiml.message(reply_text);
    }

    if (intent === 'interested' || intent === 'booked') {
      notifyHotLead(lead, body);
    }
  } catch (err) {
    console.error('Error handling inbound SMS:', err);
  }

  res.type('text/xml').send(twiml.toString());
});

function notifyHotLead(lead, message) {
  // Placeholder: wire this up to email/Slack/webhook to alert the company's
  // sales team that a lead is ready to close. For now, just logs.
  console.log(`🔥 HOT LEAD: ${lead.name} (${lead.phone}) replied: "${message}"`);
}

// --- Manual endpoint: send a one-off SMS to a lead by phone ---
app.post('/api/send', async (req, res) => {
  const { phone, message } = req.body;
  const lead = getLeadByPhone(phone);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  try {
    await sendSms(phone, message);
    logMessage(lead.id, 'outbound', message);
    updateLeadStatus(lead.id, 'contacted', { sequence_step: (lead.sequence_step || 0) + 1 });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Mark a deal closed and calculate commission ---
app.post('/api/deals/close', (req, res) => {
  const { phone, deal_value, commission_rate } = req.body;
  const lead = getLeadByPhone(phone);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const commission = recordDeal(lead.id, Number(deal_value), commission_rate || 0.5);
  res.json({ ok: true, commission_owed: commission });
});

// --- Simple dashboard data endpoints ---
app.get('/api/leads/:status', (req, res) => {
  res.json(getLeadsByStatus(req.params.status, 500));
});

app.get('/api/summary', (req, res) => {
  res.json(getCommissionSummary());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Lead reactivation server running on port ${PORT}`);
  console.log(`Twilio webhook URL to configure: ${process.env.PUBLIC_BASE_URL}/webhooks/sms`);
});
