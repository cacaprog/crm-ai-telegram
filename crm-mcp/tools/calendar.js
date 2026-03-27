import { google } from 'googleapis';
import { getAuthorizedClient } from './google-auth.js';
import * as db from '../db/index.js';

export async function get_today_briefing() {
  const auth = await getAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: 'startTime'
  });

  const events = response.data.items || [];
  const allDeals = await db.deals.findAll();

  const result = [];
  for (const event of events) {
    const title = event.summary || '(no title)';
    const start = event.start?.dateTime || event.start?.date || '';
    const end = event.end?.dateTime || event.end?.date || '';
    const attendees = (event.attendees || [])
      .map(a => a.email?.toLowerCase())
      .filter(Boolean);

    // Match by attendee email first, then fuzzy title/name
    let matchedDeal = allDeals.find(d =>
      d.email && attendees.includes(d.email.toLowerCase())
    );
    if (!matchedDeal) {
      const titleLower = title.toLowerCase();
      matchedDeal = allDeals.find(d =>
        titleLower.includes(d.title.toLowerCase()) ||
        titleLower.includes(d.contact_name.toLowerCase()) ||
        d.contact_name.toLowerCase().includes(titleLower)
      );
    }

    if (matchedDeal) {
      const deal = await db.deals.findById(matchedDeal.id);
      const activities = (await db.activities.findByDeal(matchedDeal.id)).slice(0, 5);
      result.push({ title, start, end, attendees, deal, activities });
    } else {
      result.push({ title, start, end, attendees, deal: null, activities: [] });
    }
  }

  return { date: startOfDay.toISOString().slice(0, 10), events: result };
}
