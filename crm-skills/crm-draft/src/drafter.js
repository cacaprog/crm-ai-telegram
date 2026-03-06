const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic.Anthropic();

async function draftFollowUp(deal, activities) {
  const activitySummary = activities
    .slice(0, 5)
    .map(a => `- [${a.type}] ${a.summary}`)
    .join('\n');

  const prompt = `You are a consultant's email assistant. Draft a professional, warm follow-up email.

Deal: ${deal.title}
Contact: ${deal.contact_name} <${deal.email}>
Current stage: ${deal.stage}
Next action goal: ${deal.next_action || 'Check in and keep momentum'}

Recent activity history:
${activitySummary || 'No prior activity recorded.'}

Instructions:
- Keep it short (3-5 sentences max)
- Professional but warm tone
- Clear call to action matching the next_action goal
- Do NOT use filler phrases like "I hope this email finds you well"

Respond ONLY with JSON (no markdown):
{
  "subject": "email subject line",
  "body": "full email body with greeting and sign-off"
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });

  const draft = JSON.parse(response.content[0].text);
  return { ...draft, to: deal.email, dealId: deal.id };
}

module.exports = { draftFollowUp };
