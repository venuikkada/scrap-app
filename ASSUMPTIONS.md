# Things I assumed - please check

## Placeholders you left blank
1. **App name** = "Scrap Pickup" and **city** = "Hyderabad" (guessed from Telugu). Change in `.env` (`APP_NAME`, `APP_CITY`).
2. **Service PIN codes** = 500081, 500032, 500084 (placeholders). Change in admin → Settings.

## Rates
3. Your category list did not have "Plastic mixed" but your seed prices did, so there are **10 categories** (the 9 listed + Plastic mixed ₹6/kg).
4. You gave no price for **Old appliances** and **E-waste**. I used ₹150/piece and ₹50/piece as placeholders.
   Honest warning: one flat price per piece is weak - a fridge and a mixer are not worth the same. Consider "price decided at pickup" or sub-types (fridge, washing machine, TV...) in Phase 2.
5. You gave no **resale prices**. I set placeholders about 10-40% above buy price. Update all of them before launch, or the margin numbers mean nothing.

## Money rules
6. **Partner payout** was not defined. I assumed: earning = resale value − amount paid for scrap + pickup fee, and the partner gets a share (default **50%**, editable in Settings). Business margin = the rest. Tell me if you prefer a fixed ₹ per pickup or ₹ per kg.
7. **Pickup fee is re-checked on the measured weight**, not the estimate. Otherwise a customer could type a big estimate to avoid the fee. The fee and threshold used are the ones in force when the booking was made.
8. **The customer never owes money.** If scrap is worth ₹20 and the fee is ₹50, the customer gets ₹0 (fee is capped at the scrap value).
9. Amounts are kept to the paisa (e.g. ₹358.80). Say if you want cash amounts rounded to the nearest rupee.
10. Weight is in steps of 100 g, max 1000 kg per item. Pieces are whole numbers, max 100.

## Booking rules
11. All times are **India time (IST)**. A slot for today can be booked only **until it starts** (at 12:05 PM the Afternoon slot is closed).
12. I added **Cancel**: customer can cancel while Requested or Assigned; admin can cancel until pickup. Not in your spec, but needed in real life.
13. A customer can have at most **5 open bookings** and **10 addresses** (stops spam).
14. A booking keeps its **own copy of the address**, so editing or deleting an address later does not change old bookings.
15. There is **no limit on bookings per slot**. If you have 2 partners and 30 people book Morning, you will be in trouble - consider a per-slot cap.

## Phase 1 scope
16. Partner screens are Phase 2, so in Phase 1 **the admin moves the booking** through On the way → Picked up (enters measured weights) → Paid (cash/UPI). Without this you could not test the full flow.
17. Partners only see "waiting for approval" / "approved" for now. They see no customer data at all, so the "phone number only on pickup day" rule is not broken; it will be enforced in Phase 2.
18. The app does not send any notification (SMS/WhatsApp) when a booking is made or assigned. The admin must check the dashboard. Worth adding a WhatsApp alert early.

## Login and security
19. **Real SMS OTP is not connected.** It needs a paid provider and DLT registration (a government-required SMS template approval in India, takes a few days). Test mode uses OTP 123456 for everyone - never use that with real customers.
20. Admins are created only from the command line, and log in with OTP like everyone else.
21. Login stays active for 30 days on a phone. Blocking a user logs them out immediately.
22. No Aadhaar or any ID is stored. Stored personal data: name, mobile, addresses.

## Technical choices
23. **Node.js 22.13+ with its built-in SQLite**, and no other packages. Easy to run and nothing to install, but your hosting must offer Node 22. SQLite (one file) is fine for one city and thousands of bookings; it can be moved to Postgres/Supabase later if needed.
24. The app shell is cached on the phone for speed. After you deploy an update, users see it on the **second** time they open the app.
25. English only for now. All text is in `public/i18n/en.js`, ready for Telugu.
