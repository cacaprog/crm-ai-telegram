const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic.Anthropic();

async function parseActivityLog(text, context) {
  const today = new Date().toISOString().split('T')[0];
  const prompt = `You are a CRM assistant. Parse this activity note into structured data.

Deal: ${context.dealTitle}
Contact: ${context.contactName}
Today's date: ${today}

User note: "${text}"

Respond ONLY with a JSON object (no markdown) with these fields:
- type: one of "call", "email", "meeting", "note", "proposal_sent"
- summary: 1-2 sentence summary of what happened
- next_action: what the user should do next (string or null)
- next_action_date: ISO date string YYYY-MM-DD for when to follow up (or null)`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }]
  });

  return JSON.parse(response.content[0].text);
}

module.exports = { parseActivityLog };
