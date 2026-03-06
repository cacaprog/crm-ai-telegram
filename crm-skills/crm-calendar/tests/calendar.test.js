const { formatEventSuggestion } = require('../src/index');

test('formats calendar event suggestion message', () => {
  const deal = { id: 1, title: 'Acme Deal', contact_name: 'John', email: 'john@acme.com' };
  const msg = formatEventSuggestion(deal, {
    title: 'Discovery Call - Acme',
    date: '2026-03-10',
    time: '14:00',
    duration: 60
  });
  expect(msg).toContain('Discovery Call - Acme');
  expect(msg).toContain('2026-03-10');
  expect(msg).toContain('john@acme.com');
});
