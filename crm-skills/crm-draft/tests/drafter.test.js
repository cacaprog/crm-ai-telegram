const { draftFollowUp } = require('../src/drafter');

jest.mock('@anthropic-ai/sdk', () => ({
  Anthropic: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ text: JSON.stringify({
          subject: 'Following up on our conversation',
          body: 'Hi John,\n\nThank you for the call...\n\nBest regards'
        })}]
      })
    }
  }))
}));

test('drafts email from deal context', async () => {
  const deal = {
    title: 'Acme Deal',
    stage: 'proposal',
    contact_name: 'John Smith',
    email: 'john@acme.com',
    next_action: 'Send proposal follow-up'
  };
  const activities = [
    { type: 'call', summary: 'Discovery call, John interested in automation project', created_at: new Date() }
  ];

  const draft = await draftFollowUp(deal, activities);
  expect(draft.subject).toBeDefined();
  expect(draft.body).toContain('John');
  expect(draft.to).toBe('john@acme.com');
});
