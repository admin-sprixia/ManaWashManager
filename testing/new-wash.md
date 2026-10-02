# New Wash — features and how to test them

This guide explains, in plain words, everything the **New Wash** screen does and gives a step-by-step test for each situation. Anyone in the shop can follow it; no technical knowledge needed.

Each scenario has:

- **What it's for**: why the feature exists.
- **Steps**: exactly what to tap and type.
- **What you should see**: how to tell it worked.
- **Result**: tick Pass or Fail, and write a note if something looked wrong.

---

## Part A — What New Wash does (the feature list)

New Wash is where a car or bike gets entered when it arrives. It has three steps, shown as a progress bar at the top: **Customer → Vehicle → Services**. A bar at the bottom always shows the bill and the **Start wash** button.

**1. Finding the customer**
- One search box finds a saved customer by **number plate**, **mobile number** or **name**.
- Typing only the last few digits of a plate works (e.g. "1234" finds KA01AB1234).
- Before you type anything, the most recent customers are listed.
- The search works **without internet**, using the customer list saved on the phone. Under the box it says how many vehicles are saved and when the list was last updated.
- If nothing on the phone matches an exact plate or phone number, the app quietly asks the server too (when online).
- **New customer** is always at the bottom of the list. Whatever you typed is carried into the form: a plate goes into the plate box, a number into the phone box, a name into the name box.

**2. A returning customer (welcome card)**
- Picking a saved customer shows a greeting: "WELCOME BACK" (or "GOOD TO SEE YOU" if they have no finished visits yet), their first name, which visit this is (e.g. "3rd visit"), and when they last came.
- Their plate, vehicle size and a partly hidden phone number are shown.
- **Repeat last wash** adds last time's services in one tap and shows the price.
- Their **other vehicles** are listed, one tap to switch; there's also **Add another vehicle**.
- **Edit** lets you fix their phone or name. **Change** goes back to search.

**3. A new customer (the form)**
- Three boxes: **Vehicle number**, **Mobile number** (+91), **Customer name**. Each gets a green tick when it's valid.
- Rules: the plate needs at least 4 characters; the phone must be a real 10-digit Indian mobile starting with 6, 7, 8 or 9; the name can't be empty.
- If the typed **plate is already saved**, a "SAVED VEHICLE" strip appears with a **Use** button.
- If the typed **phone is already saved** (and the plate is new), a "SAVED CUSTOMER" strip says the vehicle will be added to their profile, and their name is filled in for you.

**4. Who owns this vehicle? (ownership question)**
- If a saved plate comes in with a **different phone number**, the app asks once:
  - **Same person, new number**: updates the saved customer's number; their history stays together.
  - **New owner**: starts a fresh profile for the new number; old visits stay with the old owner.
- If the new number already belongs to **another saved customer**, "Same person" is greyed out and the choice becomes "Belongs to *that customer* now".

**5. Vehicle type**
- Pick **Cars** or **Bikes**, then a size (Hatchback, Sedan, Mini SUV, Large SUV / XUV, Bike, Scooter).
- For a returning customer the saved size is already picked, with a **Change** link.
- Changing the size clears the services you picked (because prices differ per size).

**6. Services**
- Only services for the chosen size are listed, grouped, each with its price for that size.
- A service search box appears when the list is long (more than 6 services).
- A service with no price for that size shows "No price" and can't be started.

**7. Staff commission — "Who got this service?"**
- Only for the few services the owner has set a commission on (e.g. rust coating). Normal services show nothing.
- When such a service is ticked, a "WHO GOT THIS SERVICE?" row appears. It starts with the person entering the wash.
- Tap **Change** to pick who really got the customer to take it; up to 3 people, split equally.
- The commission is earned only once the job is **paid**.

**8. Discounts, coupons and referrals (only one can be used per wash)**
- **Manual discount**: optional, needs a reason, can't be more than the bill.
- **Comeback coupon**: if a returning customer has a live coupon, a card offers it with an **Apply** button. It needs internet.
- **Referral**: only for a brand-new customer. Enter the mobile number of the customer who sent them. If allowed, the new customer gets a surprise 5–10% off, and the referrer gets their own coupon once this wash is paid. It needs internet.

**9. Starting the wash**
- The bottom bar shows the number of services, the discount, and the total.
- If something is missing, the bar says exactly what (e.g. "Add a valid 10-digit mobile number") and the button stays disabled.
- Tapping **Start wash** puts the car on the Job Board under "Waiting" and returns you to the board.
- **No internet?** The wash is saved on the phone and sent automatically later. Coupons and referrals are the exception: they need internet.
- A wash can **never be created twice**, even if the button is tapped twice or the phone retries.

**10. Opening New Wash from a customer's profile**
- The **New wash** button on a customer's profile (or next to one of their vehicles) opens New Wash with that customer and vehicle already picked.

---

## Part B — Before you start testing

### Sign in

| Who | Mobile | How to sign in |
|---|---|---|
| Owner | 9100000000 | Test build: use the recovery code **000000** (then create a PIN) |
| Staff | 9100000001 | The owner first sets a PIN for "Staff Demo" in **More → Team** |

### Make-believe customers to use

Use these so everyone tests the same way. The numbers are not real people.

| Name | Mobile | Plate | Size |
|---|---|---|---|
| Ravi Kumar | 9876500001 | KA01AB1234 | Hatchback |
| Priya Sharma | 9876500002 | KA02CD5678 | Sedan |
| Arjun Reddy | 9876500003 | KA03EF9012 | Mini SUV |
| Meena Rao | 9876500004 | KA04GH3456 | Hatchback |
| Kiran Das | 9876500005 | KA05JK7890 | Bike |

### Useful to know

- To finish a wash (so it counts as a "paid visit"), go to the **Job Board**, tap the car and move it along: **Start wash → Mark ready → Mark paid**.
- To test without internet, turn on **Airplane mode** (and make sure Wi-Fi is off too).
- Prices used below come from the starting price list, e.g. Complete Car Wash for a Hatchback is ₹400, Underbody Cleaning is ₹500.

---

## Part C — Test scenarios

### Section 1: Finding customers

#### 1.1 First-time screen with no customers
**What it's for:** a new shop has nobody saved yet.
**Steps:**
1. On a fresh app, tap **New Wash** on the Job Board.

**What you should see:**
- The search box is ready for typing (the keyboard opens by itself).
- There's no "Recent customers" list yet, only **New customer**.
- The line under the search box says "0 saved vehicles" (or "Downloading customers…").

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 1.2 Add a brand-new customer
**What it's for:** entering someone who has never visited.
**Steps:**
1. New Wash → tap **New customer**.
2. Vehicle number: `KA01AB1234`, mobile: `9876500001`, name: `Ravi Kumar`.
3. Pick **Cars → Hatchback**.
4. Tick **Complete Car Wash**.
5. Tap **Start wash · ₹400**.

**What you should see:**
- Each box gets a green tick once filled correctly.
- The progress bar fills step by step and the header says "All set — review and start".
- A message says "Wash started for Ravi · KA01AB1234" and you're back on the board.
- Ravi's car is under **Waiting** with ₹400.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 1.3 Search by plate (full and last digits)
**What it's for:** staff usually read the plate off the car.
**Steps:**
1. New Wash → type `KA01AB1234`. Check the result, then clear the box.
2. Type only `1234`.

**What you should see:** Ravi Kumar appears both times, with the matching part of the plate highlighted.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 1.4 Search by phone number
**Steps:**
1. New Wash → type `98765 00001` (with or without the space).

**What you should see:** Ravi appears, with the phone number shown and the matched digits highlighted.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 1.5 Search by name
**Steps:**
1. New Wash → type `ravi` (small letters are fine).

**What you should see:** Ravi Kumar appears with "Ravi" highlighted.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 1.6 Recent customers list
**Steps:**
1. After adding 2–3 customers, open New Wash and don't type anything.

**What you should see:** A "RECENT CUSTOMERS" list, most recent first, each row showing name, size, visits and when they last came.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 1.7 No match → "New customer" carries what you typed
**What it's for:** saves typing the same thing twice.
**Steps:**
1. Type a plate nobody has, e.g. `KA02CD5678` → tap **New customer**. Check the form, then go back to search.
2. Type a phone nobody has, e.g. `9876500002` → tap **New customer**. Check the form, then go back to search.
3. Type a name, e.g. `priya sharma` → tap **Add "Priya Sharma"**.

**What you should see:**
- It says "No saved customer matches …".
- Step 1: the plate is already in the plate box, and the cursor jumps to the phone box.
- Step 2: the phone is already filled in.
- Step 3: the name is filled in with capital letters ("Priya Sharma").

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 1.8 Search with no internet
**Steps:**
1. Turn on Airplane mode.
2. New Wash → search `1234`.

**What you should see:** Ravi still appears. The line under the box says "Offline · searching N saved vehicles".

**Result:** ☐ Pass ☐ Fail  Note: ________

---

### Section 2: Returning customers

Before this section, finish Ravi's first wash (Job Board → Start wash → Mark ready → Mark paid → Cash).

#### 2.1 Welcome card
**Steps:**
1. New Wash → search `1234` → tap Ravi.

**What you should see:**
- A teal card: "WELCOME BACK", "Ravi", which visit this is (e.g. "2nd visit") and "last here today".
- Plate KA01AB1234, "Hatchback", phone partly hidden.
- Step 1 and step 2 are already complete (Hatchback picked, "Saved from their last visit").

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 2.2 Repeat last wash
**Steps:**
1. On Ravi's welcome card, tap **Repeat last wash**.

**What you should see:**
- The button shows "Complete Car Wash" and ₹400, then changes to "Last wash added" with a tick.
- Complete Car Wash is ticked in the services list and the total is ₹400.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 2.3 Change the vehicle size for a returning customer
**Steps:**
1. With Ravi picked, tap **Change** next to "Hatchback".
2. Pick **Sedan**.

**What you should see:** The size picker opens, the services you had ticked are cleared, and prices now show Sedan prices (Complete Car Wash ₹500).

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 2.4 Customer with more than one vehicle
**Steps:**
1. With Ravi picked, tap **Add another vehicle for Ravi**.
2. Enter plate `KA09ZZ1111`; the phone and name stay filled in. Pick a size and a service, then start the wash.
3. Open New Wash again and pick Ravi (search `ravi`).

**What you should see:**
- Step 2: the form keeps Ravi's number and name; only the plate is empty.
- Step 3: under the welcome card, "RAVI'S OTHER VEHICLES" lists the other plate. Tapping it switches to that vehicle.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 2.5 Edit a returning customer's details
**Steps:**
1. Pick Ravi → tap **Edit**.
2. Change the name to `Ravi K`.
3. Tap **Cancel changes**. Then repeat, and this time start the wash with the new name.

**What you should see:**
- **Cancel changes** brings back the saved details and keeps any services already ticked.
- Starting with the edited name saves it. The next search shows "Ravi K".

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 2.6 "Change" goes back to search
**Steps:**
1. Pick Ravi → tap **Change** (top-right of the card).

**What you should see:** Back to an empty search, and nothing from Ravi is left over.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 2.7 Open New Wash from a customer's profile
**Steps:**
1. Open Ravi's profile (e.g. tap his name on a job, or find him under Customers).
2. Tap **New wash**. Go back, then tap the new-wash button next to one of his vehicles.

**What you should see:** New Wash opens with Ravi and that exact vehicle already picked. There's no need to search.

**Result:** ☐ Pass ☐ Fail  Note: ________

---

### Section 3: New customer form checks

#### 3.1 Wrong or missing details
**Steps:** New Wash → **New customer**, then try each of these (watch the bottom bar):
1. Leave everything empty.
2. Plate `KA1` (too short).
3. Mobile `12345` or `5876500001` (doesn't start with 6–9).
4. Leave the name empty.

**What you should see:** The **Start wash** button stays grey, and the bottom bar says what's missing, in order: "Add the vehicle number" → "Add a valid 10-digit mobile number" → "Add the customer's name" → "Choose a vehicle type" → "Pick at least one service".

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 3.2 Typing a plate that's already saved
**Steps:**
1. **New customer** → type plate `KA01AB1234` (Ravi's).

**What you should see:** A "SAVED VEHICLE" strip with Ravi's name, "Hatchback · N visits", and a **Use** button. Tapping **Use** switches to Ravi's welcome card.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 3.3 Saved phone, new vehicle
**Steps:**
1. **New customer** → plate `KA10NEW001`, mobile `9876500001` (Ravi's).

**What you should see:**
- A "SAVED CUSTOMER" strip: "KA10NEW001 will be added to their profile · N vehicles on file".
- The name box is filled in with Ravi's name. If you had already typed a name, it is **not** overwritten.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 3.4 Plate letters and spaces
**Steps:**
1. **New customer** → type the plate as `ka 04 gh 3456`.

**What you should see:** It turns into capital letters. After starting, it's saved as `KA04GH3456`, without spaces.

**Result:** ☐ Pass ☐ Fail  Note: ________

---

### Section 4: Who owns the vehicle?

#### 4.1 Same person, new number
**What it's for:** a regular changed their phone number.
**Steps:**
1. **New customer** → plate `KA01AB1234` (Ravi's), mobile `9876500099` (a new number).
2. Read the yellow question "Who owns KA01AB1234 now?"
3. Choose **Same person, new number**. Pick a service and start.

**What you should see:**
- The question says it's saved under Ravi, with a different number.
- The name stays "Ravi Kumar".
- Afterwards, searching `9876500099` finds Ravi with all his old visits.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 4.2 New owner
**What it's for:** the car was sold to someone else.
**Steps:**
1. **New customer** → plate `KA02CD5678` (Priya's), mobile `9876500077` (new number).
2. Choose **New owner**.

**What you should see:**
- The name box empties, and the cursor goes there so you can type the new owner's name.
- After starting, the plate belongs to the new owner. Priya's old visits stay on Priya's profile.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 4.3 The new number belongs to another saved customer
**Steps:**
1. **New customer** → plate `KA03EF9012` (Arjun's), mobile `9876500004` (Meena's).

**What you should see:**
- "Same person, new number" is greyed out: "Not possible — … is already Meena's number."
- "Belongs to Meena now" is already chosen, and the name changes to Meena's.
- After starting, the vehicle moves to Meena. Arjun's past visits stay with Arjun.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 4.4 Must answer before starting
**Steps:**
1. Type the details from 4.1 again, but don't tap either answer yet.

**What you should see:** The bottom bar says "Confirm who owns this vehicle" and the button stays grey.

**Result:** ☐ Pass ☐ Fail  Note: ________

---

### Section 5: Vehicle type and services

#### 5.1 Cars vs Bikes
**Steps:**
1. **New customer** → switch between **Cars** and **Bikes**.

**What you should see:** Each tab shows its count and its sizes. Switching clears any size and services picked.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 5.2 Services match the vehicle
**Steps:**
1. Pick **Hatchback** and look at the list, then pick **Bike**.

**What you should see:** Hatchback shows car services only, with Hatchback prices. Bike shows bike services only (e.g. Chain Clean & Lube). A service is never shown for the wrong vehicle.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 5.3 Prices change with size
**Steps:**
1. Tick **Complete Car Wash** on Hatchback (₹400). Switch the size to **Large SUV / XUV**.

**What you should see:** The ticks are cleared (a new size needs new choices), and Complete Car Wash now shows ₹700.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 5.4 Pick several services
**Steps:**
1. Hatchback → tick **Complete Car Wash** (₹400) + **Tyre Dressing** (₹50) + **Car Fragrance** (₹50).
2. Untick one.

**What you should see:** The Services step says "3 selected", the bar shows "3 services" and ₹500. Unticking updates the count and total straight away.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 5.5 Search services
**Steps:**
1. Hatchback → type `tyre` in the service search. Then type `xyz`. Then tap the ✕.

**What you should see:** Only matching services show. `xyz` shows "No services match "xyz"". The ✕ clears the search. Ticks stay ticked while searching.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 5.6 Service with no price
**Steps (owner):**
1. In **More → Services & prices**, add a new car service but don't give it a Hatchback price.
2. New Wash → Hatchback → find that service.

**What you should see:** It shows "No price". If ticked, the bar says "A selected service has no price for this vehicle" and the wash can't start.

**Result:** ☐ Pass ☐ Fail  Note: ________

---

### Section 6: Staff commission ("Who got this service?")

Setup (owner): **More → Services & prices** → tap **Underbody Cleaning → Hatchback** → set **Staff commission** to ₹150 → Save. The row should now say "Staff commission ₹150".

#### 6.1 Normal services show nothing
**Steps:**
1. New Wash, any customer, Hatchback, tick only **Complete Car Wash**.

**What you should see:** No "Who got this service?" row.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 6.2 Commission service asks who got it
**Steps:**
1. Signed in as **Staff Demo**: New Wash, Hatchback, tick **Underbody Cleaning**.

**What you should see:** A row "WHO GOT THIS SERVICE?" with "Staff Demo" and "Earns ₹150 commission, once paid".

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 6.3 Pick someone else, or share it
**Steps:**
1. Tap **Change** → untick yourself → tick **Owner** → **Done**.
2. Tap **Change** again → tick both people → **Done**.
3. Try ticking a 4th person (if the team has 4+).

**What you should see:**
- Step 1: the row shows "Owner".
- Step 2: the row shows both names and "₹75 each · ₹150 commission, once paid". The picker also says "₹75 each — shared equally."
- Step 3: "At most 3 people."

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 6.4 Only counts once paid
**Steps:**
1. Start the wash from 6.2 (Staff Demo alone).
2. As staff, open **More** → look at your numbers (month).
3. Pay the job from the board, then look again.

**What you should see:** Before payment the commission hasn't gone up. After payment it shows ₹150 and "Services got" goes up by 1.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 6.5 Fix it on the job afterwards
**Steps:**
1. Open a job with Underbody Cleaning that's **not paid yet** → the "Got the service" section → tap it → change the person → Save.
2. Pay the job. As **staff**, try to change it again. Then as **owner**, change it.

**What you should see:**
- Before payment, anyone can change it, and the activity list says "… changed who got the service to …".
- After payment, staff can't tap it. The owner can, and the subtitle says "owner only".

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 6.6 Removing the commission
**Steps (owner):**
1. Set Underbody Cleaning → Hatchback commission back to empty → Save.
2. New Wash → tick Underbody Cleaning.

**What you should see:** No "Who got this service?" row any more. Past jobs keep the commission they were started with.

**Result:** ☐ Pass ☐ Fail  Note: ________

---

### Section 7: Discounts

#### 7.1 Manual discount with a reason
**Steps:**
1. Any customer, Hatchback, Complete Car Wash (₹400).
2. Tap **Add a discount** → amount `50` → reason `regular customer`.
3. Start the wash.

**What you should see:**
- The bar shows "₹400 − ₹50 discount" and a total of ₹350; the button says "Start wash · ₹350".
- On the job's detail screen: Subtotal ₹400, "Discount · regular customer −₹50", Total ₹350.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 7.2 Discount needs a reason
**Steps:**
1. Add a discount of `50` but leave the reason empty.

**What you should see:** A red note "Add a reason so the discount can be tracked." The bar says "Add a reason for the discount" and the button stays grey.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 7.3 Discount bigger than the bill
**Steps:**
1. With ₹400 of services, enter a discount of `500`.

**What you should see:** A red note "Discount can't be more than ₹400." The bar says "Discount is more than the bill" and the button stays grey.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 7.4 Remove a discount
**Steps:**
1. Open the discount, type an amount, then tap **Remove**.

**What you should see:** The discount boxes close, and the total goes back to the full price.

**Result:** ☐ Pass ☐ Fail  Note: ________

---

### Section 8: Referral (new customer sent by an existing one)

Setup: Ravi (9876500001) must have at least one **paid** wash.

#### 8.1 A valid referral
**Steps:**
1. New Wash → **New customer** → plate `KA05JK7890`, mobile `9876500005`, name `Kiran Das`.
2. Tap **Referred by a customer?** → enter `9876500001`.
3. Pick **Bike** and a service, then start the wash (online).

**What you should see:**
- A short spinner, then a green box: "X% off · referred by Ravi Kumar −₹…" (X is between 5 and 10), with "Ravi gets their own reward once this wash is paid."
- The manual discount option disappears, because only one offer can be used.
- The bar shows "₹… − ₹… X% referral".
- On the job, the discount reason reads "Referred by Ravi Kumar · X% off".

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 8.2 The percentage doesn't change while waiting
**Steps:**
1. Get a referral quote as in 8.1 but don't start. Leave the screen open for 30+ minutes (or come back later), then start.

**What you should see:** The same percentage is kept the whole time, and the wash starts fine. It's renewed quietly in the background.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 8.3 Referral rules (each should be refused with a clear message)
**Steps:** Try each one as a **New customer** with a referral:

| Try | Expected message |
|---|---|
| Referrer number = the new customer's own number | "A customer can't refer themselves." |
| Referrer number nobody has | "No customer with that number yet — the person referring must have visited before." |
| Referrer who has visited but **never paid** | "The person referring needs at least one paid wash first." |

**What you should see:** The message in red under the box. The wash can't start until you fix or **Remove** the referral ("Fix or remove the referral").

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 8.4 Only for brand-new customers
**Steps:**
1. **New customer** with a phone **or** plate that's already saved.

**What you should see:** The "Referred by a customer?" option doesn't appear at all, because the customer isn't new.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 8.5 Referral needs internet
**Steps:**
1. Turn on Airplane mode, then set up a new customer with a referrer number.

**What you should see:** "Referral offers need internet." The wash can't be saved with the referral; the bar says to remove it. Removing the referral lets you save offline.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 8.6 The referrer gets their reward
**Steps:**
1. Pay Kiran's referred wash from 8.1.
2. New Wash → pick Ravi.

**What you should see:** A coupon card for Ravi appears (see Section 9).

**Result:** ☐ Pass ☐ Fail  Note: ________

---

### Section 9: Comeback coupon

A coupon exists after 8.6, or when the owner sends a comeback offer from **Reminders** to someone who hasn't come in 30+ days.

#### 9.1 Coupon offered to a returning customer
**Steps:**
1. New Wash → pick Ravi (who has a coupon) → Hatchback → Complete Car Wash.

**What you should see:** A dashed teal card, "X% comeback offer", the code (e.g. `MANA-1234-ABCDEF`), "till <date>", and an **Apply** button.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 9.2 Apply and remove
**Steps:**
1. Tap **Apply**, look at the bar, then tap **Remove**.

**What you should see:**
- After **Apply**, the card turns solid with a tick and shows "−₹…". The manual discount option disappears, and the bar shows "X% coupon".
- After **Remove**, everything goes back to normal.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 9.3 Coupon used once only
**Steps:**
1. Start a wash with the coupon applied.
2. Start another New Wash for Ravi.

**What you should see:** The coupon card doesn't appear the second time. On the first job, the discount reason says "Coupon MANA-… · X% off".

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 9.4 Coupon needs internet
**Steps:**
1. Pick Ravi with a coupon while online (the card appears). Turn on Airplane mode.

**What you should see:** The **Apply** button goes grey with "Needs internet to apply". If it was already applied, the bar says "Coupon needs internet — remove it to save offline".

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 9.5 Coupon is only for the owner's own vehicles and number
**Steps:**
1. Pick one of Ravi's **other** vehicles.

**What you should see:** The coupon still appears, with "sent for KA01AB1234". It never appears for a different customer, or if the phone number on file is not the owner's.

**Result:** ☐ Pass ☐ Fail  Note: ________

---

### Section 10: Starting the wash, offline use and safety

#### 10.1 Bottom bar is always honest
**Steps:**
1. Watch the bottom bar while filling in a new wash from nothing.

**What you should see:** It always shows the number of services and the running total. The button only turns blue ("Start wash · ₹…") when everything is complete. Otherwise it says in plain words what's missing.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 10.2 Start a wash with no internet
**Steps:**
1. Turn on Airplane mode.
2. New Wash → pick or add a customer → size → service → **Start wash**.
3. Turn internet back on and wait a minute.

**What you should see:**
- A message: "Saved offline — Ravi's KA01AB1234 will sync automatically".
- The car appears on the board straight away, with a "waiting to sync" mark.
- Once online, the mark goes away and the job appears on other phones too.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 10.3 No double washes
**Steps:**
1. Fill in a wash and tap **Start wash** twice quickly.
2. Also try this in a weak signal area (or toggle Airplane mode during saving).

**What you should see:** Only **one** job is created on the board, never two.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 10.4 Service list with no internet
**Steps:**
1. Open New Wash at least once while online. Then turn on Airplane mode, close and reopen the app, and open New Wash.

**What you should see:** Sizes, services and prices all load from the phone. (Only a brand-new install that has *never* been online shows: "You're offline and the service list hasn't been saved on this phone yet. Connect once to load it.")

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 10.5 Staff and owner can both enter washes
**Steps:**
1. Do test 1.2 once as the **owner** and once as **Staff Demo**.

**What you should see:** Both work. On the job's activity list, "… started a new wash" shows the right person.

**Result:** ☐ Pass ☐ Fail  Note: ________

#### 10.6 Back button and leaving halfway
**Steps:**
1. Fill in half a wash → tap the back arrow.
2. Open New Wash again.

**What you should see:** Nothing is saved as a job. The half-filled wash doesn't appear on the board.

**Result:** ☐ Pass ☐ Fail  Note: ________

---

## Part D — After the wash starts (quick checks)

These happen on the **Job Board** and the job's **detail screen**, but belong to the same journey.

| Check | How | Expected |
|---|---|---|
| Who's washing (optional) | Board → tap **Start wash** on a waiting car | A list to pick who's washing, with a **Skip** button. Skip moves the car to Washing with nobody recorded. |
| Change or clear washers | Job detail → "Washed by" | Anyone can change it, or tap **Clear**. No money depends on it. |
| Before/after photos | Job detail → Photos → camera tile | Up to **10 before** and **10 after**. The counter shows "3/10". **Choose from gallery** lets you pick several at once (only as many as are left). Without internet they're saved on the phone and upload later. |
| Photo limit | Add photos until 10/10 | The camera tile disappears at 10. |
| Mark ready → WhatsApp | Board → **Mark ready** | A prompt to send the "car is ready" WhatsApp message. |
| Payment | Board → **Mark paid** → Cash / UPI / Other | The job moves to Paid and counts in today's total. |

---

## Test log

| Date | Tester | Phone model | App version | Sections tested | Problems found |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |
