// Makes a mobile number an admin.
// Usage: npm run add-admin -- 9876543210 "Owner Name"
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';

const [mobileArg, ...nameParts] = process.argv.slice(2);
const mobile = String(mobileArg || '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
const name = nameParts.join(' ').trim() || 'Admin';

if (!/^[6-9]\d{9}$/.test(mobile)) {
  console.error('Give a 10-digit Indian mobile number.\nExample: npm run add-admin -- 9876543210 "Venu"');
  process.exit(1);
}

const db = openDb(config.dbPath);
const existing = db.prepare('SELECT id, role FROM users WHERE mobile = ?').get(mobile);
if (existing) {
  db.prepare("UPDATE users SET role = 'admin', status = 'approved', name = COALESCE(name, ?) WHERE id = ?").run(
    name,
    existing.id
  );
  console.log(`+91 ${mobile} was "${existing.role || 'new user'}" and is now an admin.`);
} else {
  db.prepare(
    "INSERT INTO users (mobile, name, role, status, created_at) VALUES (?, ?, 'admin', 'approved', ?)"
  ).run(mobile, name, new Date().toISOString());
  console.log(`Admin created: ${name}, +91 ${mobile}.`);
}
console.log('Log in to the app with this mobile number to open the admin screens.');
