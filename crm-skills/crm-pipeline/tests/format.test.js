const { formatPipeline, formatDeal } = require('../src/format');

const mockPipeline = {
  lead: [{ title: 'Acme Deal', contact_name: 'John', next_action_date: null, value: '5000.00' }],
  discovery: [],
  validation: [],
  scoping: [],
  proposal: [{ title: 'Beta Corp', contact_name: 'Jane', next_action_date: new Date('2026-03-10'), value: '25000.00' }],
  negotiation: [],
  closed_won: [],
  closed_lost: []
};

test('formatPipeline renders non-empty stages only', () => {
  const text = formatPipeline(mockPipeline);
  expect(text).toContain('LEAD');
  expect(text).toContain('Acme Deal');
  expect(text).toContain('PROPOSAL');
  expect(text).toContain('Beta Corp');
  expect(text).not.toContain('DISCOVERY');
});

test('formatDeal renders deal details with activities', () => {
  const deal = { id: 1, title: 'Test Deal', stage: 'proposal', contact_name: 'Alice', company: 'Corp', next_action: 'Send proposal', next_action_date: new Date('2026-03-15'), value: '10000.00' };
  const activities = [{ type: 'call', summary: 'Intro call', created_at: new Date('2026-03-01') }];
  const text = formatDeal(deal, activities);
  expect(text).toContain('Test Deal');
  expect(text).toContain('proposal');
  expect(text).toContain('Send proposal');
  expect(text).toContain('Intro call');
});
