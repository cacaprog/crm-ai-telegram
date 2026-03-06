const db = require('../src/index');

afterAll(() => db.end());

describe('contacts', () => {
  test('creates and retrieves a contact', async () => {
    const contact = await db.contacts.create({
      name: 'Test Person',
      company: 'Acme Corp',
      email: 'test@acme.com',
      source: 'referral'
    });
    expect(contact.id).toBeDefined();
    expect(contact.name).toBe('Test Person');

    const found = await db.contacts.findById(contact.id);
    expect(found.company).toBe('Acme Corp');

    await db.contacts.delete(contact.id);
  });
});

describe('deals', () => {
  let contactId;

  beforeAll(async () => {
    const c = await db.contacts.create({ name: 'Deal Contact', source: 'cold' });
    contactId = c.id;
  });

  afterAll(async () => {
    await db.contacts.delete(contactId);
  });

  test('creates deal with default stage lead', async () => {
    const deal = await db.deals.create({
      contactId,
      title: 'Test Deal',
      value: 10000
    });
    expect(deal.stage).toBe('lead');
    expect(deal.value).toBe('10000.00');
    await db.deals.delete(deal.id);
  });

  test('updates next_action and next_action_date', async () => {
    const deal = await db.deals.create({ contactId, title: 'Follow-up Deal' });
    const date = new Date('2026-03-10T09:00:00Z');
    const updated = await db.deals.update(deal.id, {
      nextAction: 'Send proposal',
      nextActionDate: date
    });
    expect(updated.next_action).toBe('Send proposal');
    await db.deals.delete(deal.id);
  });
});
