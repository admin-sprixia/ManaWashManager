# MANA Car Wash (customer app) – test plan and results

Every feature in `MANA-Car-Wash-Features.md`, tested by hand in the app on the tablet
(Samsung, RZ2Y4017S4L) against the local API with the demo data (`npm run db:seed:demo`).
The WhatsApp code is always **000000** locally. Payments use the local test checkout page
("Pay" / "Make it fail"), so no real money moves.

Result: ✅ works · ❌ broken (see notes) · 🔧 was broken, fixed during the run · ⏳ not tested yet

## Dummy data used

Seeded by `db:seed:demo`, plus these extras added for this run:
- A new street place **Vedayapalem 3rd Cross** (code shown in the app) near the two "Call me back"
  requests, so both of them get a "Join now" invite.
- Rohit also has a bike wash at **MANA Car Wash Kavali**, so his washes span two branches.
- Swathi's car plan has 1 wash left, so it shows "Plan ending soon".
- A test place **Green Park Residency** (code GP7KTMW, blocks A and B, flats 101–304) 150 m from
  the tablet, so a brand-new customer can join without team confirmation.
- Anil's second payment part was moved to today so "pay next part" could be tested.

| Login | Who | What this login has |
|---|---|---|
| 9139365230 | Rohit Yadav | Shop customer at Nellore + Kavali: washes with photos, an offer code, friends he invited |
| 9440011002 | Swathi Rao | Lakshmi Towers A-203: car plan ending soon + scooter plan, paid |
| 9440011001 | Anil Reddy | Lakshmi Towers A-101: quarterly plan paid in parts, washed today |
| 9440011004 | Divya K | Lakshmi Towers B-204: plan not paid yet |
| 9440011003 | Prakash N | Lakshmi Towers B-102: quarterly plan, paid (cancel test) |
| 9440011005 | Ramesh G | Sri Ram Nagar: waiting for the team to confirm |
| 9440011006 | (request) | Open "Call me back", now invited to Vedayapalem |
| 9440011020 | brand new | Nobody knows this number: new-customer flows, Call me back |
| 9440011021 | brand new | Opens the Green Park link while signed out, joins B-201, Quarterly in parts, pays |
| 9440011022 | brand new | "Use a different number" |
| 7106024391 | Nagendra Shaik | Wash "ready" today (live wash card) |
| 8288995264 | Satish Rao | Gift the car wash still owes him |

## 1. Signing in (all logins)
| # | Test | Login | Result |
|---|---|---|---|
| 1.1 | Type number, code arrives, 6 digits checked automatically | 9139365230 | ✅ |
| 1.2 | Wrong code shows a clear error | 9139365230 | ✅ |
| 1.3 | "Send a new code" after the wait | 9139365230 | ✅ |
| 1.4 | Number is remembered after sign-out | 9139365230 | ✅ |
| 1.5 | One account shows both branches (Nellore + Kavali) | 9139365230 | ✅ |

## 2. New customers (number not known)
| # | Test | Login | Result |
|---|---|---|---|
| 2.1 | "Car wash at your home" page with Find my place / Call me back | 9440011020 | ✅ |
| 2.2 | Call me back: location or area, served check | 9440011020 | ✅ |
| 2.3 | Only location + vehicles needed; optional fields work | 9440011020 | ✅ |
| 2.4 | Request status "Request sent" | 9440011020 | ✅ "Request sent" card |
| 2.5 | Change details | 9440011020 | ✅ |
| 2.6 | Cancel request | 9440011020 | ✅ |
| 2.7 | "We now wash at a place near you" + Join now | 9440011006 | ✅ invite banner + Join now opens the place (banner said "flat" for a street, fixed) |
| 2.8 | Use a different number | 9440011020 | ✅ (9440011022) back to the number screen, number filled in to edit |

## 3. Wash at your home – finding and joining
| # | Test | Login | Result |
|---|---|---|---|
| 3.1 | Places near you (location), nearest first, photos | 9440011020 | ✅ nearest first; demo places have no photos (icon shown) |
| 3.2 | Type place code from poster | 9440011020 | 🔧 works; a wrong code said the place "isn't on MANA any more" (fixed) |
| 3.3 | Deep link `manacarwash://place/CODE` opens the place | 9139365230 | ✅ |
| 3.4 | Link opened while signed out opens after sign-in | 9440011021 | ✅ signed out → link → sign in → lands on Green Park join page |
| 3.5 | Place not listed: Call me back / call branch | 9440011020 | ✅ no places nearby: Call me back + call branch |
| 3.6 | Place details: photo, wash days, time, branch | 9139365230 | ✅ |
| 3.7 | Pick flat by block and number | 9139365230 | ✅ |
| 3.8 | Parking note | 9139365230 | ✅ |
| 3.9 | Add vehicles (type picker / saved vehicles) | 9139365230, 9440011002 | ✅ |
| 3.10 | Plans tab: tags, pick a plan | 9440011002 | ✅ "Most popular" tag, "Save 10%" |
| 3.11 | One wash tab: pick services | 9139365230 | ✅ |
| 3.12 | Pay in full / in parts | 9440011002, 9440011021 | 🔧 parts amounts shown right; result screen showed the full total (fixed; rechecked: ₹1,253 now) |
| 3.13 | Summary: total, first wash, pay-by | 9139365230, 9440011002 | ✅ |
| 3.14 | Result: "You're in!" / "Almost done!" with Pay buttons | 9440011002, 9440011021 | 🔧 see 3.12 |
| 3.15 | Needs team confirmation message (joined from far away) | 9139365230 | ✅ |

## 4. Paying and receipts
| # | Test | Login | Result |
|---|---|---|---|
| 4.1 | Pay opens the payment page | 9440011002 | ✅ (renewal) |
| 4.2 | Paid → "Payment received", next wash, See receipt | 9440011002 | ✅ back in the app, "See you on Wed 14 Oct" |
| 4.3 | Failed → "No money was taken", Try again | 9440011004 | ✅ |
| 4.4 | Waiting → open again / pay later | 9440011004 | ✅ |
| 4.5 | GST receipt: number, GST, total | 9440011002, 9440011021 | ✅ ₹1,559.32 + 9% + 9% = ₹1,840; part 1 of 5: ₹1,061.86 + 9% + 9% = ₹1,253 |
| 4.6 | Share receipt | 9440011002 | ✅ |

## 5. My place and plans
| # | Test | Login | Result |
|---|---|---|---|
| 5.1 | Home "My place" card status (payment due) | 9440011004 | ✅ "Payment due" with pay-by date |
| 5.2 | Home card "Plan ending soon" | 9440011002 | 🔧 card OK; an empty "No washes yet" card sat above it (fixed) |
| 5.3 | Home card "Waiting for the team" | 9139365230 | ✅ |
| 5.4 | "Wash at your home" card when not a member | 9139365230 | ✅ |
| 5.5 | My place: flat, next wash, vehicles | 9440011002 | ✅ |
| 5.6 | Add another vehicle | 9440011002 | 🔧 works; stale "Check the highlighted parts" error stayed (fixed) |
| 5.7 | Call branch / invite neighbours | 9440011002 | ✅ dialer opens; share has the place link |
| 5.8 | Plan: washes used/left, progress | 9440011001 | ✅ |
| 5.9 | Skip a wash, undo | 9440011001 | 🔧 skip/undo work; skip was offered after the cutoff and time showed "20:00" (fixed) |
| 5.10 | Pause, end pause | 9440011001 | 🔧 works; a pause not started yet said "End" (now "Cancel") |
| 5.11 | Payment parts, pay next part | 9440011001 | 🔧 works; future parts were labelled "DUE" (now "UPCOMING"); a second Plan screen opened after paying (fixed) |
| 5.12 | Receipts list on plan | 9440011001 | ✅ |
| 5.13 | Renewal card + renew | 9440011002 | ✅ renew → pay → new plan from Wed 14 Oct |
| 5.14 | Cancel plan with refund | 9440011003 | ✅ |
| 5.15 | "I moved out" | 9440011003 | ✅ |

## 6. Home (shop customer)
| # | Test | Login | Result |
|---|---|---|---|
| 6.1 | Greeting with name, branch | 9139365230 | ✅ |
| 6.2 | Live wash card (ready) | 7106024391 | ✅ |
| 6.3 | Latest wash | 9139365230 | ✅ |
| 6.4 | Free-wash card stamps | 9139365230 | ✅ |
| 6.5 | Offer with code, copy | 9139365230 | ✅ |
| 6.6 | Gift still owed | 8288995264 | ✅ |
| 6.7 | Invite / Help shortcuts | 9139365230 | ✅ |

## 7. My washes
| # | Test | Login | Result |
|---|---|---|---|
| 7.1 | All washes at both branches, grouped by month | 9139365230 | ✅ |
| 7.2 | "Today" section for in-progress | 7106024391 | ✅ |
| 7.3 | Wash details: services, total, payment | 9139365230 | ✅ |
| 7.4 | Photos full screen + swipe | 9139365230 | ✅ |
| 7.5 | Rate 1–5 + comment, change rating | 9139365230 | ✅ |
| 7.6 | Google review button on happy rating | 9139365230 | ✅ |
| 7.7 | Report a problem with a wash | 9139365230 | ✅ |

## 8. My vehicles
| # | Test | Login | Result |
|---|---|---|---|
| 8.1 | Vehicles with plate, washes, last wash | 9139365230 | 🔧 "Last wash Today" capitalised mid-sentence (fixed) |
| 8.2 | Add vehicle: make logos, search, model, type auto | 9139365230 | ✅ |
| 8.3 | Waiting vehicle, cancel it | 9139365230 | ✅ |
| 8.4 | Remove a vehicle | 9139365230 | ✅ |

## 9. Visit us
| # | Test | Login | Result |
|---|---|---|---|
| 9.1 | Branches: open/closed, address, hours, call/WhatsApp | 9139365230 | ✅ |
| 9.2 | Price list per vehicle; shop / door switch | 9139365230 | 🔧 note started with a lowercase vehicle name (fixed) |

## 10. Invite friends
| # | Test | Login | Result |
|---|---|---|---|
| 10.1 | Invite message + share | 9139365230 | ✅ |
| 10.2 | Friends invited list | 9139365230 | ✅ |

## 11. Help & support
| # | Test | Login | Result |
|---|---|---|---|
| 11.1 | Branch details and buttons | 9139365230 | ✅ |
| 11.2 | Report a problem, see status | 9139365230 | ✅ |

## 12. Profile
| # | Test | Login | Result |
|---|---|---|---|
| 12.1 | Edit name | 9139365230 | ✅ |
| 12.2 | Sign out | 9139365230 | ✅ |
| 12.3 | Sign out on all phones | 9440011003 | ✅ |
| 12.4 | Delete account | 9440011020 | ✅ |
| 12.5 | Version + support email | 9139365230 | ✅ |

## 13. Everywhere
| # | Test | Login | Result |
|---|---|---|---|
| 13.1 | Bottom tabs | 9139365230 | ✅ |
| 13.2 | Pull to refresh | 9139365230 | ✅ home, plan, washes |
| 13.3 | No internet message + Try again | 9139365230 | ✅ |
| 13.4 | Tablet layout | all | ✅ every screen checked on the 11" tablet; nothing cut off or stretched |

## Problems found

Fixed during the run:
1. **My place showed today as the next wash day after today's wash was done.** It now skips days already washed or skipped.
2. **Pay in parts label rounded wrongly** ("4 × ₹994" when the last part is ₹992). Now "3 × ₹994 and ₹992".
3. **"Last wash Today"** on a vehicle card. Now "last wash today".
4. **Price list note began with a lowercase vehicle name.** Now starts with the name as written.
5. **A cancelled plan still said "Waiting for the team".** It now says "Cancelled" and what happens to the money.
6. **Home showed "No washes yet" above My place** for people who only use the home wash. The My place card now takes the top spot.
7. **"Check the highlighted parts" stayed on screen** after the missing vehicle was added. It now goes away when the problem is fixed.
8. **After joining with Pay in parts, the result screen showed the whole plan price** (₹6,264) instead of the first part (₹1,253). The server now sends the amount due now and the screen shows it.
9. **"1 skips left" / "1 days left"**. Now "1 skip left" / "1 day left".

10. **Plan screen kept an old pay-by date and "Last wash" after the pay-by time passed.** The first wash and pay-by are now worked out fresh.
11. **Skip was still offered after the skip cutoff, and the time showed as "20:00".** Skip is hidden after the cutoff; times show as "8 pm".
12. **A second Plan screen opened after paying a part.** Paying now returns to the same Plan screen.
13. **Future payment parts were labelled "DUE".** Now UPCOMING (future), DUE (today), LATE (missed), PAID.
14. **A pause that hadn't started offered "End".** It now says "Cancel" ("Pause cancelled.").
15. **Join invite said "pick your flat" for a street place.** Now "pick your home".
16. **Parking hint said "Basement" for a street place.** Streets now say "e.g. In front of the gate".
17. **Customers with no name got an "M" avatar.** They now get a person icon.
18. **A request with only a shared location showed an empty place line.** It now says "Location shared".
19. **A mistyped place code said the place "isn't on MANA any more".** Now "No place has this code. Check the code on the poster."

Noted, not changed:
- Kavali's vehicle size names differ from Nellore's (that is the branch's own price list).
- A removed vehicle's old washes stay in My washes (on purpose: they're history).
- Directions open in the browser on this tablet because it has no Maps app.
- After renewing early, the plan screen shows only the new plan. The old plan's last wash (today) still happens, but it is no longer shown anywhere. Worth showing "1 wash left on your current plan" there later.
- "Due Wed 7 Oct." could say "today".
- My place shows today as the next wash day after the wash time if the washer hasn't marked it yet.
- Demo places have no photos, so the place icon is shown.
- 1-a-week plans wash on the place's first wash day of the week (e.g. Wed), on purpose.
