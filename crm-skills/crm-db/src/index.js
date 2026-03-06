const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://crm_user:change_this_strong_password@localhost/crm_db'
});

const contacts = {
  async create({ name, company, role, email, phone, linkedinUrl, source }) {
    const { rows } = await pool.query(
      `INSERT INTO contacts (name, company, role, email, phone, linkedin_url, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, company, role, email, phone, linkedinUrl, source]
    );
    return rows[0];
  },
  async findById(id) {
    const { rows } = await pool.query('SELECT * FROM contacts WHERE id=$1', [id]);
    return rows[0] || null;
  },
  async findAll() {
    const { rows } = await pool.query('SELECT * FROM contacts ORDER BY name');
    return rows;
  },
  async delete(id) {
    await pool.query('DELETE FROM contacts WHERE id=$1', [id]);
  }
};

const deals = {
  async create({ contactId, title, value, notes }) {
    const { rows } = await pool.query(
      `INSERT INTO deals (contact_id, title, value, notes)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [contactId, title, value, notes]
    );
    return rows[0];
  },
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT d.*, c.name as contact_name, c.company, c.email
       FROM deals d JOIN contacts c ON c.id = d.contact_id
       WHERE d.id=$1`,
      [id]
    );
    return rows[0] || null;
  },
  async findAll({ stage } = {}) {
    const conditions = stage ? 'WHERE d.stage=$1' : '';
    const params = stage ? [stage] : [];
    const { rows } = await pool.query(
      `SELECT d.*, c.name as contact_name, c.company
       FROM deals d JOIN contacts c ON c.id = d.contact_id
       ${conditions}
       ORDER BY d.next_action_date NULLS LAST, d.created_at`,
      params
    );
    return rows;
  },
  async update(id, { stage, nextAction, nextActionDate, value, notes }) {
    const { rows } = await pool.query(
      `UPDATE deals SET
         stage = COALESCE($2, stage),
         next_action = COALESCE($3, next_action),
         next_action_date = COALESCE($4, next_action_date),
         value = COALESCE($5, value),
         notes = COALESCE($6, notes)
       WHERE id=$1 RETURNING *`,
      [id, stage, nextAction, nextActionDate, value, notes]
    );
    return rows[0];
  },
  async findStale(daysSinceActivity = 14) {
    const { rows } = await pool.query(
      `SELECT d.*, c.name as contact_name
       FROM deals d JOIN contacts c ON c.id = d.contact_id
       WHERE d.stage NOT IN ('closed_won','closed_lost')
         AND (
           SELECT MAX(a.created_at) FROM activities a WHERE a.deal_id = d.id
         ) < NOW() - INTERVAL '1 day' * $1
       ORDER BY d.updated_at`,
      [daysSinceActivity]
    );
    return rows;
  },
  async findDueForFollowUp() {
    const { rows } = await pool.query(
      `SELECT d.*, c.name as contact_name, c.email
       FROM deals d JOIN contacts c ON c.id = d.contact_id
       WHERE d.next_action_date <= NOW()
         AND d.stage NOT IN ('closed_won','closed_lost')
       ORDER BY d.next_action_date`
    );
    return rows;
  },
  async delete(id) {
    await pool.query('DELETE FROM deals WHERE id=$1', [id]);
  }
};

const activities = {
  async create({ dealId, type, summary }) {
    const { rows } = await pool.query(
      `INSERT INTO activities (deal_id, type, summary) VALUES ($1,$2,$3) RETURNING *`,
      [dealId, type, summary]
    );
    return rows[0];
  },
  async findByDeal(dealId) {
    const { rows } = await pool.query(
      `SELECT * FROM activities WHERE deal_id=$1 ORDER BY created_at DESC`,
      [dealId]
    );
    return rows;
  }
};

const reminders = {
  async create({ dealId, message, dueAt }) {
    const { rows } = await pool.query(
      `INSERT INTO reminders (deal_id, message, due_at) VALUES ($1,$2,$3) RETURNING *`,
      [dealId, message, dueAt]
    );
    return rows[0];
  },
  async findPending() {
    const { rows } = await pool.query(
      `SELECT r.*, d.title as deal_title, c.name as contact_name
       FROM reminders r
       JOIN deals d ON d.id = r.deal_id
       JOIN contacts c ON c.id = d.contact_id
       WHERE r.status = 'pending' AND r.due_at <= NOW()
       ORDER BY r.due_at`
    );
    return rows;
  },
  async updateStatus(id, status) {
    await pool.query('UPDATE reminders SET status=$2 WHERE id=$1', [id, status]);
  }
};

module.exports = { contacts, deals, activities, reminders, end: () => pool.end() };
