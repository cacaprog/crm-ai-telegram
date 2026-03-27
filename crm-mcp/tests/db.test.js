import { contacts, deals, activities, end } from '../db/index.js';

afterAll(() => end());

describe('contacts', () => {
  test('creates and retrieves a contact', async () => {
    const contact = await contacts.create({
      name: 'Test Person',
      company: 'Acme Corp',
      email: 'test@acme.com',
      source: 'referral'
    });
    expect(contact.id).toBeDefined();
    expect(contact.name).toBe('Test Person');

    const found = await contacts.findById(contact.id);
    expect(found.company).toBe('Acme Corp');

    await contacts.delete(contact.id);
  });
});

describe('deals', () => {
  let contactId;

  beforeAll(async () => {
    const c = await contacts.create({ name: 'Deal Contact', source: 'cold' });
    contactId = c.id;
  });

  afterAll(async () => {
    await contacts.delete(contactId);
  });

  test('creates deal with default stage lead', async () => {
    const deal = await deals.create({ contactId, title: 'Test Deal', value: 10000 });
    expect(deal.stage).toBe('lead');
    expect(deal.value).toBe('10000.00');
    await deals.delete(deal.id);
  });

  test('updates next_action and next_action_date', async () => {
    const deal = await deals.create({ contactId, title: 'Follow-up Deal' });
    const updated = await deals.update(deal.id, {
      nextAction: 'Send proposal',
      nextActionDate: new Date('2026-04-01T09:00:00Z')
    });
    expect(updated.next_action).toBe('Send proposal');
    await deals.delete(deal.id);
  });
});
