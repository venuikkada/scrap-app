# Test checklist (Phase 1)

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
- [ ] After the admin approves (step F), tap "Check again" → "You are approved".

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
- [ ] A partner (even approved) sees no customer details in Phase 1.
