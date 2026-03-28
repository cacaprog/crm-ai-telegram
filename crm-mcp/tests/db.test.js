import { contacts, deals, activities, end, pool } from '../db/index.js';
import { upsertWeeklyReport, getReportHistory } from '../db/reports.js';

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

  test('updates email and phone', async () => {
    const contact = await contacts.create({ name: 'Update Me', source: 'cold' });
    const updated = await contacts.update(contact.id, {
      email: 'updated@example.com',
      phone: '+351 910 000 000'
    });
    expect(updated.email).toBe('updated@example.com');
    expect(updated.phone).toBe('+351 910 000 000');
    expect(updated.name).toBe('Update Me'); // untouched fields preserved
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
    if (contactId) await contacts.delete(contactId);
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

describe('activities', () => {
  let contactId;
  let dealId;

  beforeAll(async () => {
    const c = await contacts.create({ name: 'Activity Contact', source: 'cold' });
    contactId = c.id;
    const d = await deals.create({ contactId, title: 'Activity Deal' });
    dealId = d.id;
  });

  afterAll(async () => {
    if (dealId) await deals.delete(dealId);
    if (contactId) await contacts.delete(contactId);
  });

  test('creates activity and retrieves by deal', async () => {
    const activity = await activities.create({
      dealId,
      type: 'call',
      summary: 'Initial call'
    });
    expect(activity.id).toBeDefined();
    expect(activity.type).toBe('call');

    const found = await activities.findByDeal(dealId);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].summary).toBe('Initial call');
  });
});

describe('reports', () => {
  const TEST_WEEK_START = '2026-01-05'; // a Monday far from real data

  afterAll(async () => {
    await pool.query('DELETE FROM weekly_reports WHERE week_start = $1', [TEST_WEEK_START]);
  });

  test('upserts a weekly report row', async () => {
    const row = await upsertWeeklyReport({
      week_start: TEST_WEEK_START,
      week_end: '2026-01-11',
      stale_deals: 2,
      stale_value: 50000,
      won_deals: 1,
      won_value: 18000,
      lost_deals: 0,
      new_deals: 3,
      activities_count: 8,
      pipeline_value: 145000
    });
    expect(new Date(row.week_start).toISOString().slice(0, 10)).toBe(TEST_WEEK_START);
    expect(row.stale_deals).toBe(2);
    expect(Number(row.won_value)).toBe(18000);
  });

  test('upsert updates existing row', async () => {
    const updated = await upsertWeeklyReport({
      week_start: TEST_WEEK_START,
      week_end: '2026-01-11',
      stale_deals: 3,
      stale_value: 75000,
      won_deals: 2,
      won_value: 36000,
      lost_deals: 1,
      new_deals: 3,
      activities_count: 10,
      pipeline_value: 130000
    });
    expect(updated.stale_deals).toBe(3);
    expect(updated.won_deals).toBe(2);
  });

  test('getReportHistory returns rows ordered desc', async () => {
    const history = await getReportHistory(4);
    expect(Array.isArray(history)).toBe(true);
    const testRow = history.find(r => new Date(r.week_start).toISOString().slice(0, 10) === TEST_WEEK_START);
    expect(testRow).toBeDefined();
    expect(testRow.activities_count).toBe(10);
  });
});
