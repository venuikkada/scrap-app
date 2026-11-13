# Test checklist

Start the app with `npm start`. OTP is always `123456` in test mode.
Use three browser windows (or one normal + two private/incognito windows) for the three people:

| Person | Mobile to use |
|---|---|
| Admin | the number you gave to `npm run add-admin` |
| Customer | 9000000002 |
| Partner | 9000000003 |

Tick each line when it works.

## A. Login
- [ ] Wrong mobile (e.g. `12345`) shows "Enter a valid 10-digit mobile number".
- [ ] Wrong OTP shows "Wrong OTP".
- [ ] OTP `123456` logs in.
- [ ] A new number is asked for name and Customer / Pickup partner.
- [ ] Log out works. Logging in again does not ask for the role again.

## B. Partner
- [ ] Sign up as Pickup partner → screen says "Waiting for approval".
- [ ] After the admin approves (step F), tap "Check again" → the "My pickups" screen opens.

## C. Customer - addresses
- [ ] My addresses → Add new address → save with PIN `500081`. It appears in the list.
- [ ] Edit the address and save. The change shows.
- [ ] Add an address with PIN `110001` → message says we do not pick up there yet.
- [ ] Delete an address.

## D. Customer - booking
- [ ] Book a pickup → all 10 items show with today's rate. Appliances and E-waste show "pc", others "kg".
- [ ] Add 6 kg Newspaper → estimate ₹72, pickup fee ₹50, you get ₹22, and "Add scrap worth ₹128 more for free pickup".
- [ ] Add 1 Old appliance (₹150) → value ₹222, pickup fee FREE.
- [ ] The note "Final amount is based on weight measured at pickup." is visible.
- [ ] Next → address step. The `110001` address cannot be selected.
- [ ] Next → dates show today + 7 days. Slots of today that have already started are greyed out.
- [ ] "Confirm booking" stays disabled until a time slot is chosen.
- [ ] Confirm → booking page shows status "Requested", items, estimated value, final amount "after pickup".
- [ ] Home shows the booking in "My bookings".
- [ ] Make a second booking and cancel it → status "Cancelled".

## E. Admin - dashboard and bookings
- [ ] Dashboard shows today's bookings, pickups completed today, total pickup value, active partners.
- [ ] "Needs your action" shows bookings without a partner and partners waiting for approval.
- [ ] Bookings tab: filter by date, by status, "Today" and "All dates" work.
- [ ] Open a booking: customer name, mobile, address, items and money split are shown.

## F. Admin - partners and customers
- [ ] Partners tab shows the partner as "Pending". Tap Approve → "Approved".
- [ ] Block a partner → they are logged out and cannot log in. Unblock → they can log in again.
- [ ] Customers tab lists customers with booking counts. Block / Unblock works the same way.

## G. Admin - full pickup flow
- [ ] Open the "Requested" booking → choose the approved partner → Assign → status "Assigned".
- [ ] Mark "On the way" → customer's booking page shows "On the way" (refresh the customer page).
- [ ] Enter measured weights (try a different weight from the estimate) → Save → status "Picked up".
- [ ] Final amount = measured weight × rate, minus pickup fee if the value is under ₹200.
- [ ] Choose Cash or UPI → Mark "Paid" → status "Paid", payment mode shown to the customer.
- [ ] Money split shows customer amount, partner payout and business margin.
- [ ] Dashboard "Pickups completed today" and "Total pickup value" went up.

## H. Admin - rates
- [ ] Change the Newspaper buy price and Save → "Rate updated", new row in Rate change history with your name.
- [ ] Margin shows in red if resale is lower than buy.
- [ ] A new customer booking uses the new rate.
- [ ] The **old** booking still shows the **old** rate and amount.

## I. Admin - settings
- [ ] Change pickup fee to ₹30 and threshold to ₹300 → a new booking estimate uses these.
- [ ] Old bookings keep the fee they were booked with.
- [ ] Remove `500081` from PIN codes → the customer can no longer book that address. Add it back.
- [ ] A bad PIN like `12` is rejected.

## J. Phone and install
- [ ] On a real Android phone (HTTPS link), buttons are easy to tap and nothing is cut off.
- [ ] Chrome menu → "Add to Home screen" → the app opens full screen from its icon.
- [ ] Turn on flight mode and open the app → it opens and says "No internet connection" instead of a blank page.

## K. Privacy checks
- [ ] A customer cannot open another customer's booking (change the number in the link `#/bookings/1`) → "Not found".
- [ ] A customer never sees resale price, partner payout or margin.

---

# Phase 2 checklist

Set-up: one approved partner, and one customer booking **for today** assigned to that partner
(if today's slots are over, book for tomorrow and test steps M-P tomorrow; L can be tested now).

## L. Partner - my pickups
- [ ] Partner logs in → "My pickups" shows today's assigned pickups, grouped by time slot and numbered.
- [ ] Two pickups in the same slot are ordered by PIN code, then locality.
- [ ] "Map" opens Google Maps with the customer's address.
- [ ] "Call" is shown for today's pickups and dials the customer.
- [ ] Tap tomorrow's date → tomorrow's pickups show the address but **no Call button and no phone number**.
- [ ] A pickup assigned to another partner does not appear.

## M. Partner - doing a pickup
- [ ] Open a pickup for today → "Start - I am on the way" → status "On the way" (customer sees it too).
- [ ] A pickup for tomorrow cannot be started ("You can start this pickup on the pickup day").
- [ ] Enter measured weights → "Calculate amount" → the amount to pay is shown and the app asks for the customer code.
- [ ] Customer's booking page (wait up to 20 seconds, no refresh needed) shows the amount and a 4-digit code.
- [ ] Wrong code → "Wrong code". Booking stays "On the way".
- [ ] "Change weights" → new weights → customer sees a new amount and a **new** code.
- [ ] Right code → status "Picked up".

## N. Payment
- [ ] Partner chooses Cash or UPI → Mark "Paid" → status "Paid".
- [ ] Customer's booking shows the final amount and payment mode.
- [ ] Admin's booking shows customer amount, partner payout and business margin.

## O. Partner - earnings
- [ ] Earnings tab shows today's earning and number of pickups.
- [ ] "Paid to customers today" shows cash and UPI totals. A pickup not yet marked paid shows under "Not paid yet".
- [ ] "Last 7 days" table and total are correct.

## P. Rating
- [ ] After pickup the customer's booking page shows "How was your pickup?". Choose stars, add a comment, send.
- [ ] The rating shows on the customer's booking and cannot be changed.
- [ ] Admin sees the rating on the booking and the average on the Partners page.
- [ ] Partner sees the average on the Earnings tab.

## Q. Privacy and backup
- [ ] The partner never sees the code in their own app - only the customer does.
- [ ] If the admin re-assigns a booking to another partner, the first partner can no longer open it.
- [ ] Admin can still do "Save weights and mark Picked up" from the admin booking page (skips the code).
