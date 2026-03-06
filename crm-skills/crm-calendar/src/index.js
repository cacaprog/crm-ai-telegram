const { google } = require('googleapis');

function formatEventSuggestion(deal, event) {
  return (
    `Create calendar event?\n\n` +
    `*${event.title}*\n` +
    `Date: ${event.date} at ${event.time}\n` +
    `Duration: ${event.duration} min\n` +
    `With: ${deal.contact_name} (${deal.email})\n\n` +
    `Reply /confirm_event to create, or /skip_event to skip.`
  );
}

async function createEvent(auth, { title, date, time, duration, contactEmail }) {
  const calendar = google.calendar({ version: 'v3', auth });
  const startDateTime = new Date(`${date}T${time}:00`);
  const endDateTime = new Date(startDateTime.getTime() + duration * 60000);

  const event = {
    summary: title,
    start: { dateTime: startDateTime.toISOString() },
    end: { dateTime: endDateTime.toISOString() },
    attendees: contactEmail ? [{ email: contactEmail }] : []
  };

  const response = await calendar.events.insert({
    calendarId: 'primary',
    resource: event,
    sendUpdates: 'all'
  });

  return response.data;
}

module.exports = { formatEventSuggestion, createEvent };
