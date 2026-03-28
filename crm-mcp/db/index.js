import pg from 'pg';
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/crm'
});

export const contacts = {
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
  },
  async update(id, { name, company, role, email, phone, linkedinUrl } = {}) {
    const { rows } = await pool.query(
      `UPDATE contacts SET
         name         = COALESCE($2, name),
         company      = COALESCE($3, company),
         role         = COALESCE($4, role),
         email        = COALESCE($5, email),
         phone        = COALESCE($6, phone),
         linkedin_url = COALESCE($7, linkedin_url)
       WHERE id=$1 RETURNING *`,
      [id, name, company, role, email, phone, linkedinUrl]
    );
    return rows[0];
  }
};

export const deals = {
  async create({ contactId, title, value, notes }) {
    const { rows } = await pool.query(
      `INSERT INTO deals (contact_id, title, value, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
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
  async findAllWithLastActivity() {
    const { rows } = await pool.query(
      `SELECT d.*, c.name as contact_name, c.company, c.email,
              MAX(a.created_at) as last_activity_at
       FROM deals d
       JOIN contacts c ON c.id = d.contact_id
       LEFT JOIN activities a ON a.deal_id = d.id
       GROUP BY d.id, c.name, c.company, c.email
       ORDER BY d.next_action_date NULLS LAST, d.created_at`
    );
    return rows;
  },
  async findAll({ stage } = {}) {
    const conditions = stage ? 'WHERE d.stage=$1' : '';
    const params = stage ? [stage] : [];
    const { rows } = await pool.query(
      `SELECT d.*, c.name as contact_name, c.company, c.email
       FROM deals d JOIN contacts c ON c.id = d.contact_id
       ${conditions}
       ORDER BY d.next_action_date NULLS LAST, d.created_at`,
      params
    );
    return rows;
  },
  async update(id, { stage, nextAction, nextActionDate, value, notes } = {}) {
    const { rows } = await pool.query(
      `UPDATE deals SET
         stage            = COALESCE($2, stage),
         next_action      = COALESCE($3, next_action),
         next_action_date = COALESCE($4, next_action_date),
         value            = COALESCE($5, value),
         notes            = COALESCE($6, notes)
       WHERE id=$1 RETURNING *`,
      [id, stage, nextAction, nextActionDate, value, notes]
    );
    return rows[0];
  },
  async delete(id) {
    await pool.query('DELETE FROM deals WHERE id=$1', [id]);
  }
};

export const activities = {
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
  },
  async countByTypeInRange(start, end) {
    const { rows } = await pool.query(
      `SELECT type, COUNT(*)::int as count
       FROM activities
       WHERE created_at >= $1 AND created_at < $2
       GROUP BY type`,
      [start, end]
    );
    const byType = { call: 0, meeting: 0, email: 0, note: 0, proposal_sent: 0 };
    for (const row of rows) byType[row.type] = row.count;
    return byType;
  }
};

export const end = () => pool.end();
