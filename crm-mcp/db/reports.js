import { pool } from './index.js';

export async function upsertWeeklyReport({
  week_start, week_end,
  stale_deals, stale_value,
  won_deals, won_value,
  lost_deals, new_deals,
  activities_count, pipeline_value
}) {
  const { rows } = await pool.query(
    `INSERT INTO weekly_reports
       (week_start, week_end, stale_deals, stale_value, won_deals, won_value,
        lost_deals, new_deals, activities_count, pipeline_value)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (week_start) DO UPDATE SET
       week_end         = EXCLUDED.week_end,
       stale_deals      = EXCLUDED.stale_deals,
       stale_value      = EXCLUDED.stale_value,
       won_deals        = EXCLUDED.won_deals,
       won_value        = EXCLUDED.won_value,
       lost_deals       = EXCLUDED.lost_deals,
       new_deals        = EXCLUDED.new_deals,
       activities_count = EXCLUDED.activities_count,
       pipeline_value   = EXCLUDED.pipeline_value,
       updated_at       = NOW()
     RETURNING *`,
    [week_start, week_end, stale_deals, stale_value, won_deals, won_value,
     lost_deals, new_deals, activities_count, pipeline_value]
  );
  return rows[0];
}

export async function getReportHistory(weeks = 4) {
  const { rows } = await pool.query(
    `SELECT week_start, week_end, stale_deals, stale_value, won_deals, won_value,
            lost_deals, new_deals, activities_count, pipeline_value
     FROM weekly_reports
     ORDER BY week_start DESC
     LIMIT $1`,
    [weeks]
  );
  return rows;
}
