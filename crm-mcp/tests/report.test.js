import { jest } from '@jest/globals';

// --- mock DB modules ---
jest.unstable_mockModule('../db/index.js', () => ({
  pool: {},
  contacts: {},
  deals: {
    findAllWithLastActivity: jest.fn()
  },
  activities: {
    countByTypeInRange: jest.fn()
  },
  end: jest.fn()
}));

jest.unstable_mockModule('../db/reports.js', () => ({
  upsertWeeklyReport: jest.fn().mockResolvedValue({}),
  getReportHistory: jest.fn()
}));

const db = await import('../db/index.js');
const { upsertWeeklyReport, getReportHistory } = await import('../db/reports.js');
const { get_weekly_report, get_report_history } = await import('../tools/report.js');

// Helpers
function makeDeal(overrides) {
  return {
    id: 1,
    title: 'Test Deal',
    stage: 'proposal',
    value: '25000.00',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-03-01T00:00:00Z'),
    contact_name: 'João Silva',
    ...overrides
  };
}

describe('get_weekly_report', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.activities.countByTypeInRange.mockResolvedValue({
      call: 3, meeting: 2, email: 3, note: 0, proposal_sent: 0
    });
  });

  test('identifies stale proposal deal (8 days, threshold 7)', async () => {
    const now = new Date();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000);
    db.deals.findAllWithLastActivity.mockResolvedValue([
      makeDeal({ stage: 'proposal', last_activity_at: eightDaysAgo, created_at: new Date('2026-01-01') })
    ]);

    const result = await get_weekly_report();
    expect(result.stale_deals).toHaveLength(1);
    expect(result.stale_deals[0].stage).toBe('proposal');
    expect(result.stale_deals[0].days_since_contact).toBeGreaterThanOrEqual(8);
  });

  test('does not flag proposal deal within threshold (5 days)', async () => {
    const now = new Date();
    const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000);
    db.deals.findAllWithLastActivity.mockResolvedValue([
      makeDeal({ stage: 'proposal', last_activity_at: fiveDaysAgo, updated_at: fiveDaysAgo, created_at: new Date('2026-01-01') })
    ]);

    const result = await get_weekly_report();
    expect(result.stale_deals).toHaveLength(0);
  });

  test('does not flag closed deals', async () => {
    db.deals.findAllWithLastActivity.mockResolvedValue([
      makeDeal({ stage: 'closed_won', updated_at: new Date('2026-01-01') })
    ]);

    const result = await get_weekly_report();
    expect(result.stale_deals).toHaveLength(0);
  });

  test('uses created_at as last contact when no activity date is available', async () => {
    const now = new Date();
    const fifteenDaysAgo = new Date(now - 15 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000);
    db.deals.findAllWithLastActivity.mockResolvedValue([
      makeDeal({ stage: 'lead', created_at: fifteenDaysAgo, updated_at: threeDaysAgo, last_activity_at: null })
    ]);

    const result = await get_weekly_report();
    expect(result.stale_deals).toHaveLength(1);
    expect(result.stale_deals[0].days_since_contact).toBeGreaterThanOrEqual(15);
  });

  test('returns summary with correct shape', async () => {
    db.deals.findAllWithLastActivity.mockResolvedValue([
      makeDeal({ stage: 'proposal', updated_at: new Date('2026-01-01') })
    ]);

    const result = await get_weekly_report();
    expect(result).toHaveProperty('week_start');
    expect(result).toHaveProperty('week_end');
    expect(result).toHaveProperty('stale_deals');
    expect(result).toHaveProperty('summary');
    expect(result.summary).toHaveProperty('won_deals');
    expect(result.summary).toHaveProperty('won_value');
    expect(result.summary).toHaveProperty('lost_deals');
    expect(result.summary).toHaveProperty('new_deals');
    expect(result.summary).toHaveProperty('activities_count');
    expect(result.summary).toHaveProperty('activities_by_type');
    expect(result.summary).toHaveProperty('pipeline_value');
  });

  test('calls upsertWeeklyReport after computing results', async () => {
    db.deals.findAllWithLastActivity.mockResolvedValue([]);

    await get_weekly_report();
    expect(upsertWeeklyReport).toHaveBeenCalledTimes(1);
    const args = upsertWeeklyReport.mock.calls[0][0];
    expect(args).toHaveProperty('week_start');
    expect(args).toHaveProperty('week_end');
  });
});
