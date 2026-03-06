const { buildReminderMessages } = require('../src/checker');

test('builds due follow-up messages', () => {
  const dueDeals = [
    { id: 1, title: 'Acme Deal', contact_name: 'John', next_action: 'Send proposal', next_action_date: new Date() }
  ];
  const messages = buildReminderMessages(dueDeals, []);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('Acme Deal');
  expect(messages[0]).toContain('Send proposal');
});

test('builds stale deal messages', () => {
  const staleDeals = [
    { id: 2, title: 'Old Deal', contact_name: 'Jane', stage: 'scoping' }
  ];
  const messages = buildReminderMessages([], staleDeals);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('Old Deal');
  expect(messages[0]).toContain('stale');
});

test('returns empty array when nothing is due', () => {
  expect(buildReminderMessages([], [])).toEqual([]);
});
