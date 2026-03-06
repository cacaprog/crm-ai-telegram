const { handleCommand } = require('../src/index');
const db = require('crm-db');

afterAll(() => db.end());

test('add_deal creates contact and deal', async () => {
  const result = await handleCommand('add_deal', {
    contactName: 'Jane Smith',
    company: 'Beta Corp',
    email: 'jane@beta.com',
    source: 'referral',
    title: 'Beta Corp Consulting',
    value: 25000
  });
  expect(result.deal.title).toBe('Beta Corp Consulting');
  expect(result.deal.stage).toBe('lead');
  expect(result.contact.name).toBe('Jane Smith');

  // cleanup
  await db.deals.delete(result.deal.id);
  await db.contacts.delete(result.contact.id);
});

test('get_pipeline returns deals grouped by stage', async () => {
  const result = await handleCommand('get_pipeline', {});
  expect(result).toHaveProperty('lead');
  expect(Array.isArray(result.lead)).toBe(true);
});
