// Usage: node scripts/import-leads.js path/to/leads.csv
//
// Expected CSV columns (header row required, any order):
//   name, phone, email, original_interest, last_contact_date
//
// phone numbers should be in E.164 format (e.g. +14155551234) - Twilio
// requires this. If your export has (415) 555-1234 style numbers, clean
// them up in a spreadsheet first, or extend the normalizePhone() function
// below to handle your specific format.

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { upsertLead } = require('../db');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node scripts/import-leads.js path/to/leads.csv');
  process.exit(1);
}

function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return raw;
  if (digits.length === 10) return `+1${digits}`; // assumes US - adjust for your market
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return raw; // leave as-is if it doesn't match a known pattern; flagged below
}

const csvContent = fs.readFileSync(path.resolve(filePath), 'utf8');
const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });

let imported = 0;
let skipped = 0;

for (const row of records) {
  const phone = normalizePhone(row.phone || row.Phone || '');
  if (!phone || !phone.startsWith('+')) {
    console.warn(`Skipping row - couldn't normalize phone: ${JSON.stringify(row)}`);
    skipped++;
    continue;
  }

  upsertLead({
    name: row.name || row.Name || '',
    phone,
    email: row.email || row.Email || '',
    original_interest: row.original_interest || row.interest || row.Interest || '',
    last_contact_date: row.last_contact_date || row.last_contact || '',
  });
  imported++;
}

console.log(`Imported ${imported} leads, skipped ${skipped} (bad phone format).`);
