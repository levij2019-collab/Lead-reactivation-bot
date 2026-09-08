const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const COMPANY_NAME = process.env.COMPANY_NAME || 'the company';
const COMPANY_OFFER = process.env.COMPANY_OFFER || 'our offer';

/**
 * Given a lead's reply and conversation history, ask Claude to:
 * 1. Classify intent (interested / not_interested / opted_out / needs_info / booked)
 * 2. Draft a short SMS-appropriate reply
 * Returns { intent, reply_text }
 */
async function handleIncomingReply(lead, incomingMessage, history) {
  const historyText = history
    .map((m) => `${m.direction === 'outbound' ? 'You' : 'Lead'}: ${m.body}`)
    .join('\n');

  const systemPrompt = `You are an SMS reactivation assistant for ${COMPANY_NAME}. You're texting an old/dormant lead who previously showed interest in ${COMPANY_OFFER}. Your job: re-engage them warmly, answer basic questions, and move them toward booking a call or confirming interest - without being pushy. Keep replies under 300 characters, friendly and conversational, like a real person texting (no corporate tone, no emoji overload - one emoji max if natural).

Never invent pricing, availability, or specifics you don't know - if asked something specific you can't answer, say a team member will follow up with details.

Respond ONLY with valid JSON, no markdown fences, no preamble:
{"intent": "interested" | "not_interested" | "opted_out" | "needs_info" | "booked" | "unclear", "reply_text": "your SMS reply here, or empty string if intent is opted_out"}`;

  const userPrompt = `Lead name: ${lead.name || 'there'}
Original interest: ${lead.original_interest || 'unknown'}

Conversation so far:
${historyText}

Lead just replied: "${incomingMessage}"

Classify intent and draft the next SMS reply.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Failed to parse Claude response as JSON:', raw);
    return {
      intent: 'unclear',
      reply_text: "Thanks for the reply! A team member will follow up with you shortly.",
    };
  }
}

/**
 * Generates the first-touch outreach message for a lead (deterministic template,
 * no AI call needed since it's the same opener pattern each time).
 */
function firstTouchMessage(lead) {
  const firstName = lead.name ? lead.name.split(' ')[0] : 'there';
  return `Hi ${firstName}, this is ${COMPANY_NAME} - it's been a while since we last connected about ${lead.original_interest || 'your inquiry'}. Still interested? Reply YES and we'll get you sorted, or STOP to opt out.`;
}

function followUpMessage(lead, step) {
  const firstName = lead.name ? lead.name.split(' ')[0] : 'there';
  if (step === 2) {
    return `Hi ${firstName}, just circling back - we've actually got a new offer that might be a great fit for you. Worth a quick chat? Reply YES or STOP to opt out.`;
  }
  if (step === 3) {
    return `Last check-in ${firstName} - if timing's still not right, no worries at all. Reply YES anytime and we'll pick this back up. Reply STOP to opt out.`;
  }
  return null;
}

module.exports = { handleIncomingReply, firstTouchMessage, followUpMessage };
