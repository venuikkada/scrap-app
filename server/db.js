import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  mobile TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT CHECK (role IN ('customer','partner','admin')),
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','blocked')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS otps (
  mobile TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  house_no TEXT NOT NULL,
  street TEXT NOT NULL,
  locality TEXT NOT NULL,
  pin TEXT NOT NULL,
  landmark TEXT NOT NULL DEFAULT '',
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  unit TEXT NOT NULL CHECK (unit IN ('kg','piece')),
  sort INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
-- One row per rate change. The newest row for a category is today's rate.
CREATE TABLE IF NOT EXISTS rates (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  buy_paise INTEGER NOT NULL,
  resale_paise INTEGER NOT NULL,
  effective_at TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  partner_id INTEGER REFERENCES users(id),
  address_id INTEGER NOT NULL REFERENCES addresses(id),
  address_json TEXT NOT NULL,
  pickup_date TEXT NOT NULL,
  slot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','assigned','on_the_way','picked_up','paid','cancelled')),
  payment_mode TEXT CHECK (payment_mode IN ('cash','upi')),
  -- settings copied at booking time, so later changes do not affect this booking
  fee_paise INTEGER NOT NULL,
  threshold_paise INTEGER NOT NULL,
  partner_share_pct REAL NOT NULL,
  -- estimate (from the customer's approximate quantities)
  est_value INTEGER NOT NULL,
  est_fee INTEGER NOT NULL,
  est_customer INTEGER NOT NULL,
  est_payout INTEGER NOT NULL,
  est_margin INTEGER NOT NULL,
  -- final (from weights measured at pickup)
  final_value INTEGER,
  final_fee INTEGER,
  final_customer INTEGER,
  final_payout INTEGER,
  final_margin INTEGER,
  created_at TEXT NOT NULL,
  assigned_at TEXT,
  picked_up_at TEXT,
  paid_at TEXT,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS bookings_date ON bookings(pickup_date);
CREATE TABLE IF NOT EXISTS booking_items (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  unit TEXT NOT NULL,
  est_qty REAL NOT NULL,
  measured_qty REAL,
  buy_paise INTEGER NOT NULL,
  resale_paise INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_booking ON booking_items(booking_id);
`;

// Placeholder values - the owner updates these from the admin Rates page.
// [key, unit, buy Rs, resale Rs]
const SEED_CATEGORIES = [
  ['newspaper', 'kg', 12, 15],
  ['cardboard', 'kg', 10, 13],
  ['books', 'kg', 14, 17],
  ['plastic_bottles', 'kg', 20, 25],
  ['plastic_mixed', 'kg', 6, 8],
  ['iron', 'kg', 28, 33],
  ['copper', 'kg', 450, 500],
  ['aluminium', 'kg', 110, 125],
  ['appliances', 'piece', 150, 220],
  ['ewaste', 'piece', 50, 80],
];

const SEED_SETTINGS = {
  pickup_fee_paise: 5000,
  free_threshold_paise: 20000,
  service_pins: ['500081', '500032', '500084'],
  partner_share_pct: 50,
};

export function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

function seed(db) {
  const now = new Date().toISOString();
  if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n === 0) {
    const addCat = db.prepare('INSERT INTO categories (key, unit, sort) VALUES (?, ?, ?)');
    const addRate = db.prepare(
      'INSERT INTO rates (category_id, buy_paise, resale_paise, effective_at) VALUES (?, ?, ?, ?)'
    );
    SEED_CATEGORIES.forEach(([key, unit, buy, resale], i) => {
      const id = addCat.run(key, unit, i + 1).lastInsertRowid;
      addRate.run(id, buy * 100, resale * 100, now);
    });
  }
  const addSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(SEED_SETTINGS)) addSetting.run(k, JSON.stringify(v));
}

export function getSettings(db) {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = JSON.parse(r.value);
  return out;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
