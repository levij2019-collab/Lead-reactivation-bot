const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'leads.db'));
db.pragma('journal_mode = WAL');

// --- Schema ---
db.exec(`
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  phone TEXT UNIQUE NOT NULL,
  email TEXT,
  original_interest TEXT,
  last_contact_date TEXT,
  status TEXT DEFAULT 'new',        -- new | contacted | replied | hot | booked | closed_won | closed_lost | opted_out | cold
  sequence_step INTEGER DEFAULT 0,  -- how many outreach messages sent
  last_message_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  direction TEXT NOT NULL,   -- 'outbound' | 'inbound'
  body TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  deal_value REAL,
  commission_owed REAL,
  status TEXT DEFAULT 'pending', -- pending | paid
  closed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);
`);

function upsertLead({ name, phone, email, original_interest, last_contact_date }) {
  const stmt = db.prepare(`
    INSERT INTO leads (name, phone, email, original_interest, last_contact_date)
    VALUES (@name, @phone, @email, @original_interest, @last_contact_date)
    ON CONFLICT(phone) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      original_interest = excluded.original_interest,
      last_contact_date = excluded.last_contact_date
  `);
  stmt.run({ name, phone, email, original_interest, last_contact_date });
  return db.prepare('SELECT * FROM leads WHERE phone = ?').get(phone);
}

function getLeadByPhone(phone) {
  return db.prepare('SELECT * FROM leads WHERE phone = ?').get(phone);
}

function getLeadsByStatus(status, limit = 100) {
  return db.prepare('SELECT * FROM leads WHERE status = ? LIMIT ?').all(status, limit);
}

function updateLeadStatus(id, status, extra = {}) {
  const fields = ['status = @status', 'last_message_at = CURRENT_TIMESTAMP'];
  const params = { id, status, ...extra };
  if (extra.sequence_step !== undefined) fields.push('sequence_step = @sequence_step');
  if (extra.notes !== undefined) fields.push('notes = @notes');
  db.prepare(`UPDATE leads SET ${fields.join(', ')} WHERE id = @id`).run(params);
}

function logMessage(leadId, direction, body) {
  db.prepare('INSERT INTO messages (lead_id, direction, body) VALUES (?, ?, ?)')
    .run(leadId, direction, body);
}

function getConversationHistory(leadId, limit = 20) {
  return db.prepare(
    'SELECT direction, body, created_at FROM messages WHERE lead_id = ? ORDER BY created_at ASC LIMIT ?'
  ).all(leadId, limit);
}

function recordDeal(leadId, dealValue, commissionRate = 0.5) {
  const commission = dealValue * commissionRate;
  db.prepare(
    'INSERT INTO deals (lead_id, deal_value, commission_owed) VALUES (?, ?, ?)'
  ).run(leadId, dealValue, commission);
  updateLeadStatus(leadId, 'closed_won');
  return commission;
}

function getCommissionSummary() {
  return db.prepare(`
    SELECT status, COUNT(*) as deal_count, SUM(deal_value) as total_value, SUM(commission_owed) as total_commission
    FROM deals GROUP BY status
  `).all();
}

module.exports = {
  db,
  upsertLead,
  getLeadByPhone,
  getLeadsByStatus,
  updateLeadStatus,
  logMessage,
  getConversationHistory,
  recordDeal,
  getCommissionSummary,
};
