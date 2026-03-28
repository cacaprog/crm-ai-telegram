import * as db from '../db/index.js';
import { upsertWeeklyReport, getReportHistory } from '../db/reports.js';

const STALE_THRESHOLDS = {
  lead: 14, discovery: 14, validation: 14,
  scoping: 10,
  proposal: 7,
  negotiation: 5
};

function getWeekBounds() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon...
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  const fmt = d => d.toISOString().slice(0, 10);
  return { week_start: fmt(monday), week_end: fmt(sunday), monday, sunday };
}

function daysSince(date) {
  const ms = Date.now() - new Date(date).getTime();
  if (isNaN(ms)) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export async function get_weekly_report() {
  const { week_start, week_end, monday, sunday } = getWeekBounds();

  // findAllWithLastActivity returns last_activity_at via LEFT JOIN on activities
  const allDeals = await db.deals.findAllWithLastActivity();
  const activeDeals = allDeals.filter(d => !d.stage.startsWith('closed'));

  // Stale detection: use last_activity_at if present, else fall back to created_at
  const staleDeals = activeDeals
    .map(d => {
      const lastContact = d.last_activity_at || d.created_at;
      const days = daysSince(lastContact);
      return { ...d, days_since_contact: days };
    })
    .filter(d => {
      const threshold = STALE_THRESHOLDS[d.stage];
      return threshold != null && d.days_since_contact > threshold;
    });

  // Week snapshot
  const weekStart = monday;
  const weekEnd = new Date(sunday.getTime() + 1); // exclusive upper bound

  // NOTE: uses updated_at as close-date proxy — no closed_at column in schema.
  // A deal edited after closing may appear in the wrong week's snapshot.
  const wonDeals = allDeals.filter(
    d => d.stage === 'closed_won' &&
         new Date(d.updated_at) >= weekStart &&
         new Date(d.updated_at) < weekEnd
  );
  const lostDeals = allDeals.filter(
    d => d.stage === 'closed_lost' &&
         new Date(d.updated_at) >= weekStart &&
         new Date(d.updated_at) < weekEnd
  );
  const newDeals = allDeals.filter(
    d => new Date(d.created_at) >= weekStart && new Date(d.created_at) < weekEnd
  );
  const pipelineDeals = allDeals.filter(d => !d.stage.startsWith('closed'));
  const pipeline_value = pipelineDeals.reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

  const activities_by_type = await db.activities.countByTypeInRange(weekStart, weekEnd);
  const activities_count = Object.values(activities_by_type).reduce((s, v) => s + v, 0);

  const won_value = wonDeals.reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);
  const stale_value = staleDeals.reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

  await upsertWeeklyReport({
    week_start,
    week_end,
    stale_deals: staleDeals.length,
    stale_value: stale_value > 0 ? stale_value : null,
    won_deals: wonDeals.length,
    won_value: won_value > 0 ? won_value : null,
    lost_deals: lostDeals.length,
    new_deals: newDeals.length,
    activities_count,
    pipeline_value: pipeline_value > 0 ? pipeline_value : null
  });

  return {
    week_start,
    week_end,
    stale_deals: staleDeals.map(d => ({
      id: d.id,
      title: d.title,
      contact_name: d.contact_name,
      stage: d.stage,
      days_since_contact: d.days_since_contact,
      value: d.value || null
    })),
    summary: {
      won_deals: wonDeals.length,
      won_value: won_value > 0 ? String(won_value) : null,
      lost_deals: lostDeals.length,
      new_deals: newDeals.length,
      activities_count,
      activities_by_type,
      pipeline_value: pipeline_value > 0 ? String(pipeline_value) : null
    }
  };
}

export async function get_report_history({ weeks } = {}) {
  return getReportHistory(weeks ?? 4);
}
