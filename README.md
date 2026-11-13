# Scrap Pickup (Phase 1)

A mobile-friendly web app (PWA) for doorstep scrap pickup. Customers book a pickup, the admin sets
rates, approves partners and manages bookings. It installs from the browser on Android - no Play Store.

- **No installs needed**: only Node.js 22.13 or newer. There is no `npm install` step.
- **Database**: one SQLite file (`data/app.db`), created automatically.
- **Light**: plain HTML/CSS/JavaScript, about 25 KB when compressed. Good for slow phones and slow internet.

## 1. Run it

```bash
npm start
```

Open http://localhost:3000. In test mode **every mobile number logs in with OTP `123456`**.

## 2. Settings file (optional)

Copy `.env.example` to `.env` and edit:

| Setting | Meaning | Default |
|---|---|---|
| `APP_NAME` | Name shown in the app and on the home-screen icon | Scrap Pickup |
| `APP_CITY` | City / locality shown on the login page | Hyderabad |
| `PORT` | Port the server listens on | 3000 |
| `DB_PATH` | Where the database file is stored | data/app.db |
| `OTP_MODE` | `test` (fixed OTP) or `sms` (real SMS) | test |
| `TEST_OTP` | The fixed OTP in test mode | 123456 |
| `COOKIE_SECURE` | Set `1` when running on HTTPS | 0 |
| `TRUST_PROXY` | Set `1` if behind Nginx / a hosting proxy | 0 |

## 3. Set up the database

Nothing to do. On first start the app creates `data/app.db` with all tables, the scrap categories,
placeholder rates and default settings (pickup fee ₹50, free pickup from ₹200).

- **Backup**: stop the app and copy the `data` folder.
- **Start fresh**: stop the app and delete the `data` folder.

## 4. Add an admin user

```bash
npm run add-admin -- 9876543210 "Your Name"
```

Then log in to the app with that mobile number. You will see the admin screens.
Admins can only be created this way - nobody can choose "admin" inside the app.

## 5. Change rates

1. Log in as admin and open the **Rates** tab.
2. Change the **Buy price** (what the customer gets) and/or the **Resale price** (what the recycler pays you).
   The margin updates as you type.
3. Tap **Save** on that card.

Every change is saved in **Rate change history** with date, time and who changed it.
Old bookings keep the rate they were booked at.

Pickup fee, free-pickup threshold, partner share and service PIN codes are in the **Settings** tab.

## 6. Install on an Android phone

1. Put the app on a server with **HTTPS** (browsers only allow install over HTTPS).
2. Open the link in Chrome on the phone.
3. Menu (⋮) → **Add to Home screen** / **Install app**.

## 7. Before real customers use it

- **Real OTP by SMS is not connected yet.** Pick an SMS provider (for example MSG91 or Fast2SMS), finish
  DLT registration, add their API call in `server/sms.js`, then set `OTP_MODE=sms`.
- Test mode lets anyone log in as anyone (including you, the admin). The app refuses to start with
  `NODE_ENV=production` and `OTP_MODE=test` unless you also set `ALLOW_TEST_OTP=1` for a private trial.
- Set `COOKIE_SECURE=1`, and `TRUST_PROXY=1` if your host puts the app behind a proxy.
- Update the placeholder rates and service PIN codes.
- Back up the `data` folder daily.

## 8. Tests

```bash
npm test
```

Runs the automated checks (pricing rules, login, booking flow, access control).
For manual testing on a phone follow [TESTING.md](TESTING.md). Things to confirm are in [ASSUMPTIONS.md](ASSUMPTIONS.md).

## 9. Where things are

| Path | What |
|---|---|
| `public/i18n/en.js` | **All app text.** Copy to `te.js` and translate to add Telugu. |
| `public/js/rules.js` | Pricing, pickup fee, slots and date rules (used by both server and phone). |
| `public/js/views/` | Screens: `auth.js`, `customer.js`, `admin.js`. |
| `server/api.js` | All server actions and permission checks. |
| `server/db.js` | Database tables and starting data. |
| `server/sms.js` | Where the SMS provider gets plugged in. |
| `scripts/add-admin.js` | Creates an admin. |

## What is in Phase 1

Login with mobile + OTP, role choice, partner approval, addresses, booking with live estimate,
date and slot, status tracking, booking detail, and the admin dashboard, rates, bookings, partners,
customers and settings.

Not built yet (Phase 2 and 3): partner pickup screens, door-step code confirmation, partner earnings,
ratings, monthly plan, CSV export, online payments.
