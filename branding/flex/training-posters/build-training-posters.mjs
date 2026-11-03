// Staff training sheets, one booklet per wash, A4 pages to photo-print and laminate, on pearl like
// the name board's "Thank you" side: indigo lettering, deep gold, the gold double frame. The steps
// run down a timeline across the pages, step 1 first: a numbered circle, the step, what to use and
// its minutes, then what to do as big bullet points beneath; the lift steps sit on a gold band.
// The first page opens with the wash's three stages; the last ends with the products and their
// mixes as a table, the never-do rules and the check before handing over. Products go by the
// shop's own SMW names, as on the labels of the cans and bottles; no supplier or machine brand is
// ever printed (the build stops if one slips in).
//   express wash (4 × A4) · basic wash (5 × A4) · premium wash (6 × A4)
//   each with Premium Care: express (4 × A4) · basic (5 × A4) · premium (7 × A4)
//   deep interior cleaning, with its outside wash, gloss and trim shine (6 × A4)
// Each page as a print-ready SVG and PNG preview, and the booklet as one vector PDF.
//   npm run posters:training
// The steps follow the wash manuals in ~/Documents/Sri Mana Wash/Procedures/Manuals.
// Drawn on a 915-wide canvas, scaled to A4 (1 unit ≈ 0.23 mm).

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { outputDir } from '../../lib/output.mjs';
import { esc, inline, SANS, SERIF } from '../../lib/poster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = outputDir(HERE);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** Brands we buy from: trade secrets, never on a sheet the staff see. */
const SECRET = /k(a|ä)rcher|wavex|motul|shakti|hybrid-?x|autogo|plvr/i;

// ─── The products ────────────────────────────────────────────────────────────
/**
 * Every product by its SMW name, as on its label: one set per wash, named after it (SMW-Express
 * Shampoo, SMW-Basic Shampoo…), so the staff take the can for the wash in front of them.
 */
const products = (wash) => ({
  shampoo: { name: `SMW-${wash} Shampoo`, mix: '1 : 9 to 1 : 10', use: 'Buckets, wheels, mats' },
  foam: { name: `SMW-${wash} Foam`, mix: '1 : 9 to 1 : 10', use: 'Foam lance' },
  dash: { name: `SMW-${wash} Dashboard Polish`, mix: '2–3 drops on the pad', use: 'Dashboard & panels' },
  tyre: { name: `SMW-${wash} Tyre Polish`, mix: 'Use as it comes', use: 'Side of the tyre only' },
  glass: { name: `SMW-${wash} Glass Cleaner`, mix: '1 L in 20 L of water', use: 'Glass, inside & out' },
});
const P = products('Basic');
const PE = products('Express');
/** Premium: its own set, and what only Premium uses. */
const PP = {
  ...products('Premium'),
  washer: { name: 'SMW-Premium Washer Fluid', mix: 'Ready mixed', use: 'Washer bottle' },
  wax: { name: 'SMW-Premium Wax', mix: 'Ready mixed', use: 'Paint' },
  inside: { name: 'SMW-Premium Inside Cleaner', mix: '1 : 25', use: 'Seats, steering, pedals' },
  leather: { name: 'SMW-Premium Leather Wash', mix: '10 ml in 500 ml', use: 'Leather seats only' },
  rain: { name: 'SMW-Premium Rain Guard', mix: 'Use as it comes', use: 'Windscreen, outside' },
  trim: { name: 'SMW-Premium Trim Shine', mix: 'Use as it comes', use: 'Outside black plastic' },
};

// ─── The washes ──────────────────────────────────────────────────────────────
// A step: its title, minutes, where the car is (ground, lift), what to use (products by name) and
// short lines of what to do (three, more for a big step). `pages` says what goes on each page: how
// many steps (a lift's steps stay together), then which of the products table, the never-do rules
// and the handover check; the first page also opens with the stages.
const BASIC = {
  file: 'basic-wash-training-a4',
  title: 'Basic Wash',
  place: 'ON THE LIFT',
  equipment: 'Lift  ·  Pressure washer (wide fan nozzle, foam lance)  ·  Air compressor  ·  Vacuum',
  stages: [
    ['1 – 3', 'On the ground', 'Mats out, air blow and vacuum the inside'],
    ['4 – 6', 'On the lift', 'Underbody, wheel arches, wheels and tyres'],
    ['7 – 15', 'On the ground', 'Wash, dry, dashboard, glass, finish'],
  ],
  pages: [{ steps: 3 }, { steps: 5 }, { steps: 4 }, { steps: 3 }, { then: ['products', 'never', 'check'] }],
  products: [P.shampoo, P.foam, P.dash, P.tyre, P.glass],
  steps: [
    ['Drive on & check in', 2, 'ground', ['The app'], ['Centre of the lift · engine off, handbrake on', 'Before photos: 4 corners, seats, dashboard, damage', 'Valuables out, windows closed, mirrors folded']],
    ['Mats out', 1, 'ground', ['Mat stand'], ['Take out all the mats: front, back and boot', 'Rubber mats go on the mat stand', 'Shake out the cloth mats for the vacuum']],
    ['Air blow & vacuum', 7, 'ground', ['Air gun, vacuum'], ['Air gun first: vents, seat gaps, pockets, under the seats', 'Vacuum with the seats back, then the seats forward', 'Seats back where they were, all doors closed']],
    ['Lift up', 1, 'lift', ['The lift'], ['Pads under the lifting points, never under the floor', 'Nobody inside, nothing under · call "going up"', 'Up to head height · wait for the lock to click']],
    ['Underbody & wheel arches', 3, 'lift', ['Pressure washer'], ['Rinse under the car, front to back', 'Inside every wheel arch, all the way round', 'Keep away from the engine, wires and hot exhaust']],
    ['Wheels & tyres', 3, 'lift', [P.shampoo, ' (WHEELS bucket), brushes'], ['Lower to chest height and lock again', 'Scrub the rims, between the spokes, the tyre sides', 'Wheels must be cool · rinse each wheel']],
    ['Lift down & pre-rinse', 3, 'ground', ['The lift, pressure washer'], ['Look under the car first · call "coming down"', 'Lower all the way, then rinse from the roof down', 'Gun 30–40 cm from the paint, never closer']],
    ['Snow foam', 3, 'ground', [P.foam], ['Foam from the bottom up, wait 2–3 minutes', 'Wash the rubber mats while you wait', "In hot sun, one side at a time so it doesn't dry"]],
    ['Hand wash on the foam', 5, 'ground', [P.shampoo, ' (SHAMPOO bucket), RINSE bucket'], ['Wash on the foam: straight lines, light hands', 'Roof → glass → bonnet → boot → doors', 'Rinse the mitt in RINSE after every panel']],
    ['Rinse', 2, 'ground', ['Pressure washer'], ['Rinse from the roof down', 'Check mirrors, handles, grille, number plates', 'No soap left anywhere']],
    ['Air blow & dry', 3, 'ground', ['Air gun, drying towels'], ['Air gun first: mirrors, handles, grille, gaps', 'Towel flat, pull slowly: glass, roof, bonnet, boot, sides', 'Open the doors, wipe the door edges and steps']],
    ['Dashboard & door panels', 4, 'ground', [P.dash, ', foam pad'], ['Damp inside towel wipes off the dust', '2–3 drops on the pad, rub on thin, buff dry', 'Soft, not shiny · never on the steering, pedals or screen']],
    ['Glass inside & out', 3, 'ground', [P.glass, ', two glass towels'], ['Spray on the towel, never on the glass', 'Outside, lift the wipers · inside, windows down a little', "Buff dry · check from the driver's seat"]],
    ['Tyre shine', 1, 'ground', [P.tyre, ', tyre pad'], ['Tyre polish on the pad, not on the tyre', 'Only the side of the tyre', 'Never on the rim or the tread']],
    ['Mats in & hand over', 2, 'ground', ['The app'], ["Dry mats back in their places, driver's mat on its clips", "Walk round the car, sit in the driver's seat once", 'Drive off the lift · mark Done in the app']],
  ],
  never: [
    'the thin pencil jet on paint or tyres',
    'go under the car before the lock clicks',
    'an outside towel inside the car',
    'shine on the steering, pedals or seats',
  ],
  check: [
    'No mud under the car, in the arches or under the doors',
    'No soap on mirrors, handles, grille or number plates',
    'Wheels clean · tyre shine only on the tyre sides',
    'No dust or sand on the floor, under seats, in the boot',
    'Dashboard and door panels even, no streaks',
    'Steering, gear knob and pedals clean, not slippery',
    "Inside glass clear from the driver's seat",
    'Seats back where the customer had them',
    "Mats dry, in place, driver's mat on its clips",
    'Lift fully down, the bay clear for the next car',
  ],
  team: 'Two people: about 25 minutes · one outside, one inside · only one person works the lift',
};

const EXPRESS = {
  file: 'express-wash-training-a4',
  title: 'Express Wash',
  place: 'ON THE GROUND',
  equipment: 'Pressure washer (wide fan nozzle, foam lance)  ·  Knee pad  ·  No lift for Express',
  stages: [
    ['1 – 2', 'Check in', 'Park, photos, rubber mats out'],
    ['3 – 7', 'Wash', 'Wheels, rinse, foam, hand wash, rinse'],
    ['8 – 11', 'Finish', 'Dry, glass, tyre shine, hand over'],
  ],
  pages: [{ steps: 3 }, { steps: 4 }, { steps: 4 }, { then: ['products', 'never', 'check'] }],
  products: [PE.shampoo, PE.foam, PE.glass, PE.tyre],
  steps: [
    ['Park & check in', 2, 'ground', ['The app'], ['Ground bay, level · engine off, handbrake on', 'Before photos: 4 corners, any scratch or dent', 'Valuables out, windows closed, mirrors folded']],
    ['Mats out', 1, 'ground', ['Mat stand'], ['Take out the rubber mats, front and back', 'Rubber mats go on the mat stand', 'Cloth mats stay inside: they are in Basic']],
    ['Wheels & tyres', 3, 'ground', [PE.shampoo, ' (WHEELS bucket), brushes'], ['Kneel on the pad · wheels must be cool', 'Scrub the rims, between the spokes, the tyre sides', 'Rinse low, angled up into the wheel arch']],
    ['Pre-rinse', 2, 'ground', ['Pressure washer'], ['Gun 30–40 cm from the paint, roof down', 'Then one low round: under the doors and bumpers', 'Away from badges, sensors and rubber seals']],
    ['Snow foam', 3, 'ground', [PE.foam], ['Foam from the bottom up, wait 2–3 minutes', 'Wash the rubber mats while you wait', "In hot sun, one side at a time so it doesn't dry"]],
    ['Hand wash on the foam', 5, 'ground', [PE.shampoo, ' (SHAMPOO bucket), RINSE bucket'], ['Wash on the foam: straight lines, light hands', 'Roof → glass → bonnet → boot → doors', 'Rinse the mitt in RINSE after every panel']],
    ['Rinse', 2, 'ground', ['Pressure washer'], ['Roof down, then one low round', 'Check mirrors, handles, grille, number plates', 'Switch off the pressure washer, hang up the gun']],
    ['Dry & door edges', 3, 'ground', ['Drying towels'], ['Towel flat, pull slowly: glass, roof, bonnet, boot, sides', 'Open every door and wipe the door edges', 'Mirrors, fuel lid, bonnet and boot edges']],
    ['Outside glass', 2, 'ground', [PE.glass, ', two glass towels'], ['Spray on the towel, never on the glass', 'Windscreen, windows, back glass, mirrors', 'Lift the wipers · buff dry, no lines']],
    ['Tyre shine', 1, 'ground', [PE.tyre, ', tyre pad'], ['Tyre polish on the pad, not on the tyre', 'Only the side of the tyre', 'Never on the rim or the tread']],
    ['Mats in & hand over', 1, 'ground', ['The app'], ["Dry mats back in, driver's mat on its clips", 'Walk round the car once · unfold the mirrors', 'Mark Done in the app · hand over the keys']],
  ],
  never: [
    'the thin pencil jet on paint or tyres',
    'the lift: Express is washed on the ground',
    'anything inside the car: that is Basic Wash',
    'scrape bird droppings or tar: tell the customer',
  ],
  check: [
    'No soap on mirrors, handles, grille or number plates',
    'No mud under the doors, behind the wheels, in the arches',
    'No water dripping from mirrors or door edges',
    'Glass clear, no lines',
    'Wheels clean between the spokes',
    'Tyre shine only on the side of the tyres',
    "Mats dry, in place, driver's mat on its clips",
    'Mirrors unfolded',
    'Nothing of ours left in the car',
    'Pressure washer off, hose out of the way',
  ],
  team: 'Two people: about 15 minutes · only one person holds the pressure washer',
};
/**
 * Premium is always washed by two people at once, Person 1 on the outside and Person 2 on the
 * inside: about 50 minutes. Each step says who does it; the minutes are that person's work.
 */
const WHO = {
  'Drive on & check in': 'outside', 'Mats out': 'inside', 'Air blow & vacuum': 'both', 'Lift up': 'outside',
  'Underbody & wheel arches': 'outside', 'Wheels & tyres': 'outside', 'Lift down & pre-rinse': 'outside', 'Snow foam': 'outside',
  'Hand wash on the foam': 'outside', 'Rinse': 'outside', 'Air blow & dry': 'outside', 'Windscreen washer top-up': 'inside',
  'Spray wax': 'outside', 'Dashboard & door panels': 'inside', 'Seats, steering & vents': 'inside', 'Glass inside & out': 'both',
  'Rain repellent': 'outside', 'Black trim shine': 'outside', 'Tyre shine': 'outside', 'Mats in & hand over': 'both',
  // With Premium Care
  'Premium Care kit': 'inside', 'Yellow snow foam': 'outside', 'Wash & wax hand wash': 'outside', 'Plush dry & gloss': 'outside', 'Check & buff': 'outside',
};
const PREMIUM = {
  file: 'premium-wash-training-a4',
  title: 'Premium Wash',
  place: 'ON THE LIFT',
  time: '50 MINUTES  ·  2 PEOPLE',
  who: WHO,
  equipment: 'Lift  ·  Pressure washer (wide fan nozzle, foam lance)  ·  Air compressor  ·  Vacuum',
  stages: [
    ['1 – 3', 'On the ground', 'Check in, mats out, air blow and vacuum'],
    ['4 – 6', 'On the lift', 'Underbody, wheel arches, wheels and tyres'],
    ['7 – 20', 'On the ground', 'Wash, wax, inside detail, glass, finish'],
  ],
  pages: [{ steps: 3 }, { steps: 5 }, { steps: 5 }, { steps: 4 }, { steps: 3, then: ['never'] }, { then: ['products', 'check'] }],
  products: [PP.shampoo, PP.foam, PP.washer, PP.wax, PP.dash, PP.inside, PP.leather, PP.glass, PP.rain, PP.trim, PP.tyre],
  steps: [
    ['Drive on & check in', 3, 'ground', ['The app'], ['Centre of the lift · engine off, handbrake on', 'Before photos: 4 corners, seats, dashboard, damage', 'Valuables out · tell them old stains may not come out']],
    ['Mats out', 1, 'ground', ['Mat stand'], ['Take out all the mats: front, back and boot', 'Rubber mats go on the mat stand', 'Shake out the cloth mats for the vacuum']],
    ['Air blow & vacuum', 7, 'ground', ['Air gun, vacuum'], ['Air gun first: vents, seat gaps, pockets, under the seats', 'Vacuum with the seats back, then the seats forward', 'Seats back where they were, all doors closed']],
    ['Lift up', 1, 'lift', ['The lift'], ['Pads under the lifting points, never under the floor', 'Nobody inside, nothing under · call "going up"', 'Up to head height · wait for the lock to click']],
    ['Underbody & wheel arches', 3, 'lift', ['Pressure washer'], ['Rinse under the car, front to back', 'Inside every wheel arch, all the way round', 'Keep away from the engine, wires and hot exhaust']],
    ['Wheels & tyres', 4, 'lift', [PP.shampoo, ' (WHEELS bucket), brushes'], ['Lower to chest height and lock again', 'Scrub rims, spokes, tyre sides · extra on brake dust', 'Wheels must be cool · rinse each wheel']],
    ['Lift down & pre-rinse', 3, 'ground', ['The lift, pressure washer'], ['Look under the car first · call "coming down"', 'Lower all the way, then rinse from the roof down', 'Gun 30–40 cm from the paint, never closer']],
    ['Snow foam', 3, 'ground', [PP.foam], ['Foam from the bottom up, wait 2–3 minutes', 'Wash the rubber mats while you wait', "In hot sun, one side at a time so it doesn't dry"]],
    ['Hand wash on the foam', 7, 'ground', [PP.shampoo, ' (SHAMPOO bucket), RINSE bucket'], ['Straight lines · rinse the mitt after every panel', 'Roof → glass → bonnet → boot → doors', 'Bird droppings & tar: soak, lift gently, never scrape']],
    ['Rinse', 2, 'ground', ['Pressure washer'], ['Rinse from the roof down', 'Check mirrors, handles, grille, number plates', 'No soap left anywhere']],
    ['Air blow & dry', 4, 'ground', ['Air gun, drying towels'], ['Air gun first: mirrors, handles, grille, gaps', 'Towel flat, pull slowly: glass, roof, bonnet, boot, sides', 'Door edges & steps · paint fully dry before the wax']],
    ['Windscreen washer top-up', 2, 'ground', [PP.washer, ', pouring can'], ['Bonnet open · the cap with the windscreen picture', 'Only that cap: never oil, coolant or brake fluid', 'Fill, close, test both sprays · blocked? tell them']],
    ['Spray wax', 8, 'ground', [PP.wax, ', two wax towels'], ['One panel at a time, in the shade, on cool paint', '2–3 light sprays · spread with towel 1, buff with towel 2', 'No wax on glass, rubber seals or black plastic']],
    ['Dashboard & door panels', 4, 'ground', [PP.dash, ', foam pad'], ['Damp inside towel wipes off the dust', '2–3 drops on the pad, rub on thin, buff dry', 'Soft, not shiny · never on the steering, pedals or screen']],
    ['Seats, steering & vents', 13, 'ground', [PP.inside, ', ', PP.leather], ['Spray on the towel or brush, never into the car', 'Vents: brush, then blow the dust out of the door', 'Steering & gear knob: Inside Cleaner on a towel, dry at once', 'Cloth seats: light spray, brush, damp towel, dry towel', 'Leather seats: Leather Wash on the towel, wipe, dry · no brush', 'Pockets, rails, pedals: brush and wipe · pedals not slippery', 'Seats back where they were · leave the doors open to air']],
    ['Glass inside & out', 4, 'ground', [PP.glass, ', two glass towels'], ['Spray on the towel, never on the glass', 'Outside, lift the wipers · inside, windows down a little', "Buff dry · check from the driver's seat"]],
    ['Rain repellent', 4, 'ground', [PP.rain, ', applicator'], ['Outside of the windscreen only, clean and dry', 'Small overlapping circles · do steps 18 and 19 while it hazes', 'Buff until perfectly clear · never test the washer after']],
    ['Black trim shine', 3, 'ground', [PP.trim, ', pad'], ['Only clean, dry, outside black plastic', 'A little on the pad, rub in thin, wipe off the extra', 'Never on paint, glass, wipers, tyre tread or inside']],
    ['Tyre shine', 1, 'ground', [PP.tyre, ', tyre pad'], ['Tyre polish on the pad, not on the tyre', 'Only the side of the tyre', 'Never on the rim or the tread']],
    ['Mats in & hand over', 3, 'ground', ['The app'], ['Dry mats back in · touch the seats: they must be dry', 'Walk round, sit in once · drive off the lift · mark Done', 'Tell them: rain repellent on, washer bottle full']],
  ],
  never: [
    'the thin pencil jet on paint or tyres',
    'go under the car before the lock clicks',
    'spray cleaner into the car or on a screen',
    'wax, silicone or shine on glass, steering or pedals',
  ],
  check: [
    'No mud under the car, in the arches or under the doors',
    'Paint shines evenly, no wax lines (look from the side)',
    'No wax or silicone on glass, rubber or black plastic',
    'Windscreen perfectly clear · washer bottle full',
    'Wheels clean, no brake dust · tyre shine on the sides only',
    'Seats clean, dry to the touch, back in place',
    'Steering, gear knob and pedals clean, not slippery',
    'Dashboard soft and even · inside glass clear',
    'Mats dry, in place · lift down, the bay clear',
  ],
  team: 'Always two people at once: Person 1 outside, Person 2 inside · only Person 1 works the lift',
};


// ─── Premium Care ────────────────────────────────────────────────────────────
/** Premium Care's own products. Their mixes go on the cans once the products are in. */
const CARE = {
  foam: { name: 'SMW-Care Yellow Foam', mix: 'Ready mixed', use: 'Care foam bottle' },
  wash: { name: 'SMW-Care Wash & Wax', mix: 'See the can', use: 'Fresh bucket each car' },
  gloss: { name: 'SMW-Care Gloss', mix: 'Ready mixed', use: 'Wet paint, in the dry' },
};

/**
 * A wash with Premium Care: the same steps, with the Care kit made ready after check-in, the Care
 * foam, wash and dry in place of the usual ones, Premium's spray wax cut to a check (the gloss went
 * on in the dry), and the water beading shown at hand over.
 */
function withCare(base, extra) {
  const airBlow = base.steps.some((s) => /^Air blow & dry$/.test(s[0]));
  const steps = base.steps.flatMap((s, i) => {
    const [title, , where, , todo] = s;
    const out = [];
    if (title === 'Snow foam') out.push(['Yellow snow foam', 5, where, [CARE.foam], ['Thick, even yellow foam, from the bottom up', 'Let it work 3–5 minutes · never let it dry', 'Foam while the customer watches · wash the mats']]);
    else if (title === 'Hand wash on the foam') out.push(['Wash & wax hand wash', 8, where, [CARE.wash, ', RINSE bucket'], ['Wash on the foam: straight lines, light hands', 'Slow, full passes so the wax covers every panel', 'Rinse the mitt in RINSE after every panel']]);
    else if (title === 'Rinse') out.push([title, s[1], where, s[3], [todo[0], todo[1], 'Water beads and runs off: the wax is working']]);
    else if (/^(Dry & door edges|Air blow & dry)$/.test(title))
      out.push([
        'Plush dry & gloss',
        7,
        where,
        [CARE.gloss, ', plush Care towels'],
        airBlow
          ? ['Air gun first: mirrors, handles, grille, gaps', '1–2 light sprays of Gloss on the wet panel, pull dry', 'Buff with a dry plush towel · never on glass or plastic']
          : ['1–2 light sprays of Gloss on the wet panel', 'Plush towel flat, pull slowly · buff with a dry one', 'Never on glass or black plastic · then the door edges'],
      ]);
    else if (title === 'Spray wax') out.push(['Check & buff', 3, where, ['A dry wax towel'], ['The gloss went on in the dry: check every panel', 'Look from the side · buff any line away', 'No wax on glass, rubber seals or black plastic']]);
    else if (i === base.steps.length - 1) out.push([title, s[1], where, s[3], [...todo, 'Sprinkle water on the bonnet: show it beading']]);
    else out.push(s);
    if (i === 0) out.push(['Premium Care kit', 2, 'ground', [CARE.foam, ', ', CARE.wash], ['Care foam bottle onto the foam lance', 'A fresh Wash & Wax bucket, for this car only', 'Clean RINSE bucket · plush Care towels · Gloss bottle']]);
    return out;
  });
  return { ...base, ...extra, steps, products: [...base.products, CARE.foam, CARE.wash, CARE.gloss] };
}

const CARE_NEVER = [
  'Wash & Wax in the normal bucket, or normal shampoo in the Care one',
  'plush Care towels on wheels or inside the car',
];
const CARE_CHECK = ['Paint shines evenly, no streaks or towel marks', 'Water beads on the bonnet (show the customer)', 'No gloss on glass or black plastic', 'Plush Care towels in their own basket'];

const EXPRESS_CARE = withCare(EXPRESS, {
  file: 'express-premium-care-training-a4',
  title: 'Express + Premium Care',
  stages: [
    ['1 – 3', 'Check in', 'Park, photos, Care kit, mats out'],
    ['4 – 8', 'Care wash', 'Wheels, rinse, yellow foam, wash & wax'],
    ['9 – 12', 'Finish', 'Plush dry & gloss, glass, tyres, hand over'],
  ],
  pages: [{ steps: 3 }, { steps: 4 }, { steps: 5 }, { then: ['products', 'never', 'check'] }],
  never: [EXPRESS.never[0], EXPRESS.never[1], EXPRESS.never[2], ...CARE_NEVER],
  check: [...CARE_CHECK, EXPRESS.check[0], EXPRESS.check[1], EXPRESS.check[3], EXPRESS.check[6]],
  team: 'Two people: about 20 minutes · only one person holds the pressure washer',
});

const BASIC_CARE = withCare(BASIC, {
  file: 'basic-premium-care-training-a4',
  title: 'Basic + Premium Care',
  stages: [
    ['1 – 4', 'On the ground', 'Check in, Care kit, mats out, air blow & vacuum'],
    ['5 – 7', 'On the lift', 'Underbody, wheel arches, wheels and tyres'],
    ['8 – 16', 'On the ground', 'Yellow foam, wash & wax, gloss, inside, finish'],
  ],
  pages: [{ steps: 3 }, { steps: 5 }, { steps: 5 }, { steps: 3, then: ['never'] }, { then: ['products', 'check'] }],
  never: [BASIC.never[0], BASIC.never[1], BASIC.never[2], ...CARE_NEVER],
  check: [...CARE_CHECK, BASIC.check[0], BASIC.check[3], BASIC.check[5], BASIC.check[8], BASIC.check[9]],
  team: 'Two people: about 30 minutes · one outside, one inside · only one person works the lift',
});

const PREMIUM_CARE = withCare(PREMIUM, {
  file: 'premium-premium-care-training-a4',
  title: 'Premium + Premium Care',
  stages: [
    ['1 – 4', 'On the ground', 'Check in, Care kit, mats out, air blow & vacuum'],
    ['5 – 7', 'On the lift', 'Underbody, wheel arches, wheels and tyres'],
    ['8 – 21', 'On the ground', 'Care wash, gloss, inside detail, finish'],
  ],
  pages: [{ steps: 3 }, { steps: 5 }, { steps: 5 }, { steps: 4 }, { steps: 4 }, { then: ['products', 'never'] }, { then: ['check'] }],
  never: [PREMIUM.never[0], PREMIUM.never[1], ...CARE_NEVER],
  check: [...CARE_CHECK, PREMIUM.check[0], PREMIUM.check[3], PREMIUM.check[5], PREMIUM.check[6]],
  time: '65 MINUTES  ·  2 PEOPLE',
  team: 'Always two people at once: Person 1 outside, Person 2 inside · only Person 1 works the lift',
});

// ─── Deep Interior Cleaning ──────────────────────────────────────────────────
/** Deep Interior's own products. Mixes the labels will give are marked "See the can" for now. */
const DEEP = {
  fabric: { name: 'SMW-Deep Fabric Shampoo', mix: 'See the can', use: 'Seats, carpet, roof' },
  interior: { name: 'SMW-Deep Interior Cleaner', mix: 'See the can', use: 'Leather, dash, vents' },
  degreaser: { name: 'SMW-Deep Degreaser', mix: '1 : 25', use: 'Edges, rails, pedals' },
  conditioner: { name: 'SMW-Deep Conditioner', mix: 'Use as it comes', use: 'Leather & dashboard' },
  glass: { name: 'SMW-Deep Glass Cleaner', mix: '1 L in 20 L of water', use: 'Glass, inside & out' },
};

// Every surface inside, deep cleaned, then the outside washed free with the Care gloss and the
// trim shine while the inside dries. On the ground; the seats take one of steps 8 and 9.
const DEEP_INTERIOR = {
  file: 'deep-interior-cleaning-training-a4',
  title: 'Deep Interior Cleaning',
  place: 'ON THE GROUND',
  time: 'ABOUT 4½ HOURS',
  equipment: 'Wet & dry vacuum  ·  Drill brushes  ·  Air compressor  ·  Pressure washer  ·  Fan',
  stages: [
    ['1 – 4', 'Prepare', 'Check in, empty the car, air blow, vacuum'],
    ['5 – 12', 'Deep clean', 'Roof, vents, dashboard, seats, carpets, mats'],
    ['13 – 21', 'Wash & finish', 'Outside wash, gloss & trim, dry, protect'],
  ],
  pages: [{ steps: 3 }, { steps: 5 }, { steps: 5 }, { steps: 5 }, { steps: 3, then: ['never'] }, { then: ['products', 'check'] }],
  products: [DEEP.fabric, DEEP.interior, DEEP.degreaser, DEEP.conditioner, DEEP.glass, PE.shampoo, PE.foam, CARE.gloss, PP.trim, PE.tyre],
  steps: [
    ['Check in', 10, 'ground', ['The app'], ['Before photos: every seat, the carpet, roof, every stain', 'Tell them: old ink, burns and dye may not come out', 'Leather, fabric or both? · it needs a few hours to dry']],
    ['Empty the car', 5, 'ground', ["A box for the customer's things"], ['All mats out: front, back and boot', "Their things in a box, kept at the counter", 'Look under the seats, in the pockets and the boot']],
    ['Air blow', 10, 'ground', ['Air gun, detailing brush'], ['AC vents, console gaps, seat gaps, under the seats', 'Brush the vents while you blow', 'Top to bottom: roof, dashboard, seats, floor']],
    ['Full dry vacuum', 15, 'ground', ['Vacuum, crevice tool, brush tool'], ['Seats all the way back, then all the way forward', 'Seats, gaps, pockets, boot, spare wheel area', 'Carpet slowly, both ways, to lift the sand out']],
    ['Roof lining', 15, 'ground', [DEEP.fabric, ' on a towel, soft brush'], ['Never spray on the roof: cleaner on the towel', 'Small sections, light strokes, one direction', 'Blot dry at once · sun visors and grab handles too']],
    ['AC vents', 10, 'ground', [DEEP.interior, ' on a brush, air gun'], ['Cleaner on the brush, never into the vent', 'Between every blade, front and back', 'Blow out, wipe · vents back where they were']],
    ['Dashboard, doors & steering', 20, 'ground', [DEEP.interior, ', brushes'], ['On the towel or brush, never on the car', 'Dashboard, console, cup holders, door panels', 'Steering, gear knob, handbrake: clean them twice', 'Screen, buttons and meter: dry towel only']],
    ['Leather seats', 25, 'ground', [DEEP.interior, ', soft horsehair brush'], ['Leather only · test on a hidden spot first', 'Cleaner on the brush, small circles, one panel at a time', 'Wipe at once: damp towel, then dry · never soak']],
    ['Fabric seats', 30, 'ground', [DEEP.fabric, ', soft drill brush, wet vacuum'], ['Fabric only · test on a hidden spot first', 'Light, even spray · wait 1–2 min · soft drill brush, slow', 'Extract until almost no water comes up', 'Stains: once more · cloth door inserts the same way']],
    ['Carpets & floor', 25, 'ground', [DEEP.fabric, ', medium drill brush, wet vacuum'], ['One area at a time: driver, passenger, back, boot', 'Spray, wait 1–2 min, drill brush, extract', "The driver's footwell twice"]],
    ['Edges, rails, pedals & belts', 15, 'ground', [DEEP.degreaser], ['Door edges, sills, steps and the boot edge', 'Seat rails and pedals · pedals wiped dry', 'Belts pulled out, wiped, clipped out to dry']],
    ['Mats', 15, 'ground', [DEEP.fabric, ', ', DEEP.degreaser], ['Cloth mats: spray, drill brush, extract, sun to dry', 'Rubber mats: degreaser, brush, rinse, dry', 'Do them while the seats and carpet soak']],
    ['Wheels, rinse & foam', 8, 'ground', [PE.shampoo, ', ', PE.foam], ['All doors and windows closed first', 'Wheels: scrub, then rinse low into the arches', 'Rinse roof down · foam bottom up, wait 2–3 min']],
    ['Hand wash & rinse', 8, 'ground', [PE.shampoo, ', two buckets'], ['On the foam: straight lines, light hands', 'Rinse the mitt in RINSE after every panel', 'Rinse roof down, then one low round']],
    ['Plush dry & gloss', 7, 'ground', [CARE.gloss, ', plush Care towels'], ['Air gun first: mirrors, handles, grille, gaps', '1–2 light sprays of Gloss on the wet panel, pull dry', 'Buff with a dry plush towel · never on glass or plastic']],
    ['Black trim shine', 3, 'ground', [PP.trim, ', pad'], ['Only clean, dry, outside black plastic', 'A little on the pad, rub in thin, wipe off the extra', 'Never on paint, glass, wipers, tyre tread or inside']],
    ['Tyre shine', 1, 'ground', [PE.tyre, ', tyre pad'], ['Tyre polish on the pad, not on the tyre', 'Only the side of the tyre', 'Never on the rim or the tread']],
    ['Dry the inside', 45, 'ground', ['Fan, open doors'], ['All doors open, the fan blowing in', 'Hot and sunny: windows down, let the sun help', 'Press a dry towel on the seats: it must come away dry']],
    ['Protect', 15, 'ground', [DEEP.conditioner, ', foam pad'], ['Leather: thin coat, buff dry · soft, not slippery', 'Dashboard, console, doors: thin, buff · soft, not glossy', 'Never on steering, gear knob, pedals or screens']],
    ['Glass inside & out', 10, 'ground', [DEEP.glass, ', two glass towels'], ['Spray on the towel, never on the glass', 'Inside: windows down a little for the top edge', "Outside too · check from the driver's seat"]],
    ['Mats in & hand over', 10, 'ground', ['The app'], ['Dry mats in · belts rolled back · seats, mirrors, vents back', 'After photos from the same angles · mark Done', 'Show before & after · "keep the windows a little open"']],
  ],
  never: [
    'spray anything straight onto the roof lining',
    'soak a seat or carpet: light spray, good extraction',
    'a stiff brush on leather: only the soft one',
    'cleaner on screens, buttons, the meter or speakers',
    'hand over a car with damp seats or carpet',
  ],
  check: [
    'No dust in the vents, gaps, seat rails or boot',
    'Seats and carpets dry to the touch',
    'Roof lining flat, no sagging, no water marks',
    'Leather soft, not slippery or sticky',
    'Dashboard soft, no streaks or glare in the windscreen',
    'Steering, gear knob and pedals clean, not slippery',
    "Glass clear from the driver's seat",
    'Paint glossy, trim dark, no gloss on glass or plastic',
    'Seats, mirrors and vents where the customer had them',
    'Their things given back · after photos taken',
  ],
  team: 'Two people: about 1¾ hours of work, plus drying · split the inside, one does the outside',
};

// ─── Look ────────────────────────────────────────────────────────────────────
// Pearl, as on the name board's back.
const C = {
  ink: '#141B47',
  indigo: '#1B2878',
  soft: '#5C6AA8',
  rule: '#C99A4E',
  gold: '#8E5D1B', // gold that reads on pearl, for small type
  band: '#F6E7C8', // the lift band
  red: '#B3261E',
  pearl: '#FBF9F4',
  row: '#F3EEE2', // a table's every other row
};
const DEFS = `<defs>
<linearGradient id="pearl" x1="0" y1="0" x2="0.12" y2="1"><stop offset="0" stop-color="#FDFCF8"/><stop offset="1" stop-color="#EFEDE6"/></linearGradient>
<linearGradient id="goldDeep" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D2A250"/><stop offset="0.55" stop-color="#B07C2C"/><stop offset="1" stop-color="#8E5D1B"/></linearGradient>
<linearGradient id="goldRule" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#C99A4E" stop-opacity="0"/><stop offset="0.15" stop-color="#C99A4E"/><stop offset="0.85" stop-color="#C99A4E"/><stop offset="1" stop-color="#C99A4E" stop-opacity="0"/></linearGradient>
<linearGradient id="bandFade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.band}" stop-opacity="0.95"/><stop offset="1" stop-color="${C.band}" stop-opacity="0.3"/></linearGradient>
<linearGradient id="lineFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.rule}" stop-opacity="0.7"/><stop offset="1" stop-color="${C.rule}" stop-opacity="0"/></linearGradient>
</defs>`;
const diamond = (cx, cy, r, fill = C.rule) => `<path d="M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z" fill="${fill}"/>`;
/** A gold rule with a diamond in the middle. */
const goldRule = (x1, x2, y) => `<rect x="${x1}" y="${y - 0.8}" width="${x2 - x1}" height="1.6" fill="url(#goldRule)"/>${diamond((x1 + x2) / 2, y, 6)}`;
/** A heading set on a gold rule. */
const ruleHeading = (x1, x2, y, label, w) =>
  `<rect x="${x1}" y="${y - 0.8}" width="${x2 - x1}" height="1.6" fill="url(#goldRule)"/>` +
  `<rect x="${(x1 + x2) / 2 - w / 2}" y="${y - 14}" width="${w}" height="28" fill="${C.pearl}"/>` +
  `<text x="${(x1 + x2) / 2}" y="${y + 5.5}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="15" letter-spacing="4" fill="${C.soft}">${label}</text>`;

/** Words into lines of at most `max` characters. */
function wrap(text, max) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > max) lines.push(line), (line = word);
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** A "Use" line, with the product names in bold gold. */
const useLine = (parts) =>
  parts.map((p) => (typeof p === 'string' ? esc(p) : `<tspan font-weight="700" fill="${C.gold}">${esc(p.name)}</tspan>`)).join('');

// ─── Pages ───────────────────────────────────────────────────────────────────
const A4 = { w: 210, h: 297 };
const W = 915;
const K = A4.w / W;
const H = A4.h / K;
const L = 64;
const R = W - L;

// The step block: circle on the line, the step and its minutes, what to use, three bullets.
const LINE_X = L + 28;
const TITLE_X = L + 82;
const BULLET = { fs: 22, lh: 32, first: 90 };
/** A step's height: its bullets set it. */
const stepH = (step) => BULLET.first + BULLET.lh * (step[4].length - 1) + 12;
const STEP_GAP = 42;
const MAX_CHARS = Math.floor((R - TITLE_X - 30) / (BULLET.fs * 0.48));

function page(content) {
  return (
    `<g transform="scale(${K})"><rect width="${W}" height="${H}" fill="url(#pearl)"/>` +
    `<rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="20" fill="none" stroke="url(#goldDeep)" stroke-opacity="0.8" stroke-width="3"/>` +
    `<rect x="31" y="31" width="${W - 62}" height="${H - 62}" rx="13" fill="none" stroke="${C.soft}" stroke-opacity="0.16" stroke-width="1.4"/>` +
    `${content}</g>`
  );
}

/** The first page's header: logo, the wash, its shape and machines. Returns where content starts. */
function bigHeader(wash) {
  const logo = inline('sri-mana-wash-horizontal-on-light.svg', L, 70, 260, 'th');
  const [first, ...rest] = wash.title.split(' ');
  // The title shrinks to fit beside the logo ("Express + Premium Care").
  const size = Math.min(76, (R - L - 300) / (wash.title.length * 0.47));
  const minutes = wash.steps.reduce((a, s) => a + s[1], 0);
  const line = `${wash.steps.length} STEPS  ·  ${wash.time ?? `${minutes} MINUTES`}  ·  ${wash.place}`;
  return {
    svg:
      logo.svg +
      `<text x="${R}" y="82" text-anchor="end" font-family="${SANS}" font-weight="700" font-size="15" letter-spacing="6" fill="${C.soft}">STAFF TRAINING</text>` +
      `<text x="${R}" y="150" text-anchor="end" font-family="${SERIF}" font-size="${size.toFixed(1)}" fill="${C.indigo}">${esc(first)} <tspan font-style="italic" fill="url(#goldDeep)">${esc(rest.join(' '))}</tspan></text>` +
      goldRule(L, R, 184) +
      `<text x="${W / 2}" y="222" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="23" letter-spacing="4" fill="${C.gold}">${esc(line)}</text>` +
      `<text x="${W / 2}" y="252" text-anchor="middle" font-family="${SANS}" font-size="17" fill="${C.soft}">${esc(wash.equipment)}</text>` +
      (wash.who
        ? `<text x="${W / 2}" y="282" text-anchor="middle" font-family="${SANS}" font-size="17.5" fill="${C.ink}"><tspan font-weight="700" fill="${C.gold}">PERSON 1: OUTSIDE</tspan>  the car, the lift, the wash   ·   <tspan font-weight="700" fill="${C.indigo}">PERSON 2: INSIDE</tspan>  the cabin</text>`
        : ''),
    top: wash.who ? 316 : 290,
  };
}

/** Later pages' header: the mark, the wash, the page. */
function smallHeader(wash, n, of) {
  const mark = inline('sri-mana-wash-mark.svg', L, 58, 30, `tm${n}`);
  // A long title ("Premium + Premium Care") keeps just the page on the right.
  const label = wash.title.length > 14 ? `PAGE ${n} OF ${of}` : `STAFF TRAINING  ·  PAGE ${n} OF ${of}`;
  return {
    svg:
      mark.svg +
      `<text x="${L + 44}" y="88" font-family="${SERIF}" font-size="34" fill="${C.indigo}">${esc(wash.title)}</text>` +
      `<text x="${R}" y="86" text-anchor="end" font-family="${SANS}" font-weight="700" font-size="14" letter-spacing="5" fill="${C.soft}">${label}</text>` +
      goldRule(L, R, 118),
    top: 172,
  };
}

/** The three stages of the wash, across the first page. */
function stages(wash, y) {
  let svg = ruleHeading(L, R, y, 'THE WASH IN 3 STAGES', 330);
  const cw = (R - L) / wash.stages.length;
  wash.stages.forEach(([steps, where, what], i) => {
    const x = L + i * cw;
    const lift = /lift/i.test(where);
    svg += `<text x="${x + cw / 2}" y="${y + 62}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="15" letter-spacing="2" fill="${C.soft}">STEPS ${esc(steps)}</text>`;
    svg += `<text x="${x + cw / 2}" y="${y + 96}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="27" fill="${lift ? C.gold : C.indigo}">${esc(where)}</text>`;
    wrap(what, 26).forEach((line, j) => {
      svg += `<text x="${x + cw / 2}" y="${y + 126 + j * 22}" text-anchor="middle" font-family="${SANS}" font-size="16.5" fill="${C.ink}">${esc(line)}</text>`;
    });
    if (i < wash.stages.length - 1) svg += `<path d="M${x + cw - 10} ${y + 80}l12 9-12 9" fill="none" stroke="${C.rule}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  return { svg, h: 180 };
}

/** Steps `from`..`to` (0-based) as a timeline from y. `more`/`before`: the line runs off the page. */
function timeline(wash, from, to, y, { before, more }) {
  const steps = wash.steps.slice(from, to);
  let at = y;
  const ys = steps.map((s) => ((at += stepH(s) + STEP_GAP), at - stepH(s) - STEP_GAP));
  let svg = '';
  // The lift band behind its steps.
  const lifts = steps.map((s, i) => (s[2] === 'lift' ? i : -1)).filter((i) => i >= 0);
  if (lifts.length) {
    const a = ys[lifts[0]] - 34;
    const b = ys[lifts.at(-1)] + stepH(steps[lifts.at(-1)]) + 4;
    svg += `<rect x="${L - 18}" y="${a}" width="${R - L + 36}" height="${b - a}" rx="16" fill="url(#bandFade)"/>`;
    svg += `<text transform="translate(${R + 6} ${(a + b) / 2}) rotate(-90)" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="13" letter-spacing="4" fill="${C.gold}">ON THE LIFT</text>`;
  }
  // The line, running on to the next page or in from the last.
  const lineTop = before ? y - 46 : ys[0];
  const lineEnd = ys.at(-1);
  svg += `<rect x="${LINE_X - 1.6}" y="${lineTop}" width="3.2" height="${lineEnd - lineTop}" fill="${C.rule}" opacity="0.7"/>`;
  if (more) svg += `<rect x="${LINE_X - 1.6}" y="${lineEnd}" width="3.2" height="${stepH(steps.at(-1)) + 40}" fill="url(#lineFade)"/>`;
  steps.forEach(([title, min, where, use, todo], i) => {
    const n = from + i + 1;
    const sy = ys[i];
    const lift = where === 'lift';
    svg += `<circle cx="${LINE_X}" cy="${sy + 3}" r="26" fill="${lift ? 'url(#goldDeep)' : C.indigo}" stroke="${C.pearl}" stroke-width="5"/>`;
    svg += `<text x="${LINE_X}" y="${sy + 12.5}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="${n > 9 ? 23 : 27}" fill="#FFFFFF">${n}</text>`;
    // The step, and its minutes at the right.
    svg += `<text x="${TITLE_X}" y="${sy + 14}" font-family="${SANS}" font-weight="700" font-size="34" fill="${C.ink}">${esc(title)}</text>`;
    const who = wash.who?.[title];
    if (who) {
      const label = { outside: 'OUTSIDE', inside: 'INSIDE', both: 'BOTH' }[who];
      const fill = { outside: C.band, inside: '#E8ECFF', both: C.pearl }[who];
      const ink = who === 'inside' ? C.indigo : C.gold;
      svg += `<rect x="${R - 196}" y="${sy - 12}" width="196" height="30" rx="15" fill="${fill}" stroke="${ink}" stroke-opacity="${who === 'both' ? 0.5 : 0}" stroke-width="1.2"/>`;
      svg += `<text x="${R - 98}" y="${sy + 9}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="16" letter-spacing="1" fill="${ink}">${label}  ·  ${min} MIN</text>`;
    } else {
      svg += `<rect x="${R - 92}" y="${sy - 12}" width="92" height="30" rx="15" fill="${lift ? C.pearl : C.band}"/>`;
      svg += `<text x="${R - 46}" y="${sy + 9}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="17" letter-spacing="1" fill="${C.gold}">${min} MIN</text>`;
    }
    // What to use.
    svg += `<text x="${TITLE_X}" y="${sy + 50}" font-family="${SANS}" font-size="19" fill="${C.ink}"><tspan font-weight="700" font-size="14" letter-spacing="2.5" fill="${C.soft}">USE</tspan><tspan dx="10">${useLine(use)}</tspan></text>`;
    // What to do, beneath.
    todo.forEach((line, j) => {
      if (line.length > MAX_CHARS) console.warn(`  ${wash.file}: step ${n} line too long: "${line}"`);
      const by = sy + BULLET.first + j * BULLET.lh;
      svg += diamond(TITLE_X + 7, by - 7, 5.5, C.rule);
      svg += `<text x="${TITLE_X + 26}" y="${by}" font-family="${SANS}" font-size="${BULLET.fs}" fill="${C.ink}">${esc(line)}</text>`;
    });
  });
  return { svg, h: ys.at(-1) + stepH(steps.at(-1)) - y };
}

/** Products and mixes as a table: product, mix, what it's for, which steps. */
function productTable(wash, y) {
  const stepsOf = (p) =>
    wash.steps
      .map((s, i) => (s[3].includes(p) ? i + 1 : 0))
      .filter(Boolean)
      .join(', ');
  // Columns as wide as their longest entry; what it's for takes what's left before the steps.
  const used = wash.products.filter((p) => stepsOf(p));
  wash = { ...wash, products: used };
  const big = wash.products.length > 6;
  const fs = big ? 17 : 19;
  const useFs = big ? 15 : 16;
  const width = (texts, size, min) => Math.max(min, Math.max(...texts.map((t) => t.length)) * size * 0.53 + 34);
  const nameW = width(wash.products.map((p) => p.name), fs, 200);
  const mixW = width(wash.products.map((p) => p.mix), fs, 210);
  const stepsW = Math.max(80, Math.max(...wash.products.map((p) => stepsOf(p).length)) * (fs - 1) * 0.5 + 30);
  const cols = [
    ['PRODUCT', L],
    ['MIX (PRODUCT : WATER)', L + nameW],
    ['USED FOR', L + nameW + mixW],
    ['STEPS', R - stepsW],
  ];
  const useMax = Math.floor((R - stepsW - cols[2][1] - 24) / (useFs * 0.44));
  for (const p of wash.products) if (p.use.length > useMax) console.warn(`  ${wash.file}: "${p.use}" is too long for the table`);
  const rowH = big ? 44 : 50;
  let svg = ruleHeading(L, R, y, 'PRODUCTS &amp; MIX', 250);
  const ty = y + 40;
  svg += `<rect x="${L}" y="${ty}" width="${R - L}" height="44" rx="10" fill="${C.indigo}"/>`;
  for (const [label, x] of cols) svg += `<text x="${x + 16}" y="${ty + 28}" font-family="${SANS}" font-weight="700" font-size="${big ? 12 : 13.5}" letter-spacing="${big ? 1.5 : 2}" fill="#FFFFFF">${label}</text>`;
  wash.products.forEach((p, i) => {
    const ry = ty + 44 + i * rowH;
    const by = ry + rowH - (big ? 16 : 18);
    if (i % 2) svg += `<rect x="${L}" y="${ry}" width="${R - L}" height="${rowH}" fill="${C.row}"/>`;
    svg += `<text x="${cols[0][1] + 16}" y="${by}" font-family="${SANS}" font-weight="700" font-size="${fs}" fill="${C.indigo}">${esc(p.name)}</text>`;
    svg += `<text x="${cols[1][1] + 16}" y="${by}" font-family="${SANS}" font-weight="700" font-size="${fs}" fill="${C.gold}">${esc(p.mix)}</text>`;
    svg += `<text x="${cols[2][1] + 16}" y="${by}" font-family="${SANS}" font-size="${useFs}" fill="${C.ink}">${esc(p.use)}</text>`;
    svg += `<text x="${cols[3][1] + 16}" y="${by}" font-family="${SANS}" font-weight="600" font-size="${fs - 1}" fill="${C.soft}">${esc(stepsOf(p))}</text>`;
  });
  const bottom = ty + 44 + wash.products.length * rowH;
  svg += `<rect x="${L}" y="${ty}" width="${R - L}" height="${bottom - ty}" rx="10" fill="none" stroke="${C.rule}" stroke-opacity="0.6" stroke-width="1.4"/>`;
  return { svg, h: bottom - y };
}

/** The never-do rules, and the two-person line. */
function rules(wash, y) {
  let svg = ruleHeading(L, R, y, 'NEVER', 150);
  wash.never.forEach((rule, i) => {
    const nx = L + 40;
    const ny = y + 54 + i * 35;
    svg += `<path d="M${nx + 2} ${ny - 14}l13 13m0 -13l-13 13" stroke="${C.red}" stroke-width="3" stroke-linecap="round"/>`;
    svg += `<text x="${nx + 28}" y="${ny}" font-family="${SANS}" font-weight="600" font-size="20" fill="${C.ink}"><tspan font-weight="700" fill="${C.red}">Never</tspan> ${esc(rule)}</text>`;
  });
  return { svg, h: 54 + (wash.never.length - 1) * 35 + 12 };
}

/** The check before handing over: a box to tick in the head for each. */
function checklist(wash, y) {
  let svg = ruleHeading(L, R, y, 'CHECK BEFORE HANDING OVER', 400);
  wash.check.forEach((item, i) => {
    const cx = L + 40;
    const cy = y + 54 + i * 32;
    svg += `<rect x="${cx + 1}" y="${cy - 17}" width="19" height="19" rx="4" fill="none" stroke="${C.indigo}" stroke-width="2"/>`;
    svg += `<text x="${cx + 34}" y="${cy}" font-family="${SANS}" font-size="18" fill="${C.ink}">${esc(item)}</text>`;
  });
  return { svg, h: 54 + (wash.check.length - 1) * 32 + 12 };
}

/** The two-person line. */
const teamLine = (wash, y) =>
  `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="17" fill="${C.indigo}">${esc(wash.team)}</text>`;

/** The page number along the bottom. */
const footer = (n, of) =>
  `<text x="${W / 2}" y="${H - 50}" text-anchor="middle" font-family="${SANS}" font-size="13" letter-spacing="3" fill="${C.soft}">SRI MANA WASH  ·  ${n} / ${of}</text>`;

// ─── Output ──────────────────────────────────────────────────────────────────
async function booklet(wash) {
  const of = wash.pages.length;
  if (wash.pages.reduce((a, pg) => a + (pg.steps ?? 0), 0) !== wash.steps.length) throw new Error(`${wash.file}: pages don't add up to the steps`);
  const sections = { products: productTable, never: rules, check: checklist };
  const files = [];
  let from = 0;
  for (let n = 1; n <= of; n++) {
    const pg = wash.pages[n - 1];
    const to = from + (pg.steps ?? 0);
    const head = n === 1 ? bigHeader(wash) : smallHeader(wash, n, of);
    let content = head.svg;
    let y = head.top;
    if (n === 1) {
      const s = stages(wash, y);
      content += s.svg;
      y += s.h + 70;
    }
    if (to > from) {
      const t = timeline(wash, from, to, y, { before: from > 0, more: to < wash.steps.length });
      content += t.svg;
      y += t.h + (pg.then ? 56 : 0);
    }
    for (const key of pg.then ?? []) {
      const sec = sections[key](wash, y);
      content += sec.svg;
      y += sec.h + 48;
    }
    if (n === of) content += teamLine(wash, y - 6);
    if (y > H - 80) console.warn(`  ${wash.file}: page ${n} runs over (${Math.round(y)} of ${Math.round(H - 80)})`);
    content += footer(n, of);
    const name = `${wash.file}-page-${n}`;
    const label = `Sri Mana Wash staff training: ${wash.title}, page ${n} of ${of} (A4)`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${A4.w} ${A4.h}" width="${A4.w}mm" height="${A4.h}mm" role="img" aria-label="${esc(label)}">
<title>${esc(label)}</title>
${DEFS}
${page(content)}
</svg>
`;
    const leak = svg.replace(/<title>[\s\S]*?<\/title>/, '').match(SECRET);
    if (leak) throw new Error(`${wash.file}: page ${n} names a supplier ("${leak[0]}"); use the SMW name`);
    const svgPath = join(OUT, `${name}.svg`);
    writeFileSync(svgPath, svg);
    await sharp(Buffer.from(svg.replace(`width="${A4.w}mm" height="${A4.h}mm"`, 'width="1240" height="1754"')))
      .png()
      .toFile(join(OUT, `${name}-preview.png`));
    files.push(svgPath);
    from = to;
  }
  // One PDF, a page per sheet.
  if (existsSync(CHROME) && !process.env.NO_PDF) {
    const html = join(OUT, `.${wash.file}.html`);
    writeFileSync(
      html,
      `<!doctype html><meta charset="utf-8"><title>${esc(wash.title)}</title><style>@page{size:A4;margin:0}html,body{margin:0;padding:0}img{display:block;width:210mm;height:297mm;break-after:page}img:last-child{break-after:auto}</style>` +
        files.map((f) => `<img src="${pathToFileURL(f).href}">`).join(''),
    );
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files', `--print-to-pdf=${join(OUT, `${wash.file}.pdf`)}`, pathToFileURL(html).href], { stdio: 'ignore' });
    rmSync(html);
  }
  console.log(`wrote ${wash.file} (${of} × A4)`);
}

await booklet(EXPRESS);
await booklet(BASIC);
await booklet(PREMIUM);
await booklet(EXPRESS_CARE);
await booklet(BASIC_CARE);
await booklet(PREMIUM_CARE);
await booklet(DEEP_INTERIOR);
