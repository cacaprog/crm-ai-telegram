const STAGES = ['lead','discovery','validation','scoping','proposal','negotiation','closed_won','closed_lost'];

const STAGE_LABELS = {
  lead: 'LEAD', discovery: 'DISCOVERY', validation: 'VALIDATION',
  scoping: 'SCOPING', proposal: 'PROPOSAL', negotiation: 'NEGOTIATION',
  closed_won: 'CLOSED WON', closed_lost: 'CLOSED LOST'
};

function formatMoney(val) {
  if (!val) return '';
  return ` ($${Number(val).toLocaleString()})`;
}

function formatDate(d) {
  if (!d) return 'no date set';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatPipeline(grouped) {
  const lines = ['*Your Pipeline*\n'];
  for (const stage of STAGES) {
    const deals = grouped[stage] || [];
    if (deals.length === 0) continue;
    lines.push(`*${STAGE_LABELS[stage]}* (${deals.length})`);
    for (const d of deals) {
      const due = d.next_action_date ? ` — due ${formatDate(d.next_action_date)}` : '';
      lines.push(`  • ${d.title} / ${d.contact_name}${formatMoney(d.value)}${due}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function formatDeal(deal, activities = []) {
  const lines = [
    `*${deal.title}*`,
    `Contact: ${deal.contact_name}${deal.company ? ' @ ' + deal.company : ''}`,
    `Stage: ${STAGE_LABELS[deal.stage] || deal.stage}`,
    deal.value ? `Value: $${Number(deal.value).toLocaleString()}` : null,
    '',
    `*Next action:* ${deal.next_action || 'None set'}`,
    `*Due:* ${formatDate(deal.next_action_date)}`,
    deal.notes ? `\n*Notes:* ${deal.notes}` : null,
    '',
    `*Activity (last ${Math.min(activities.length, 5)}):*`
  ].filter(Boolean);

  for (const a of activities.slice(0, 5)) {
    lines.push(`  [${formatDate(a.created_at)}] ${a.type}: ${a.summary}`);
  }

  return lines.join('\n');
}

module.exports = { formatPipeline, formatDeal };
