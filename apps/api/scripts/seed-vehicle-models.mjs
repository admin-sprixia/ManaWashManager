// Demo data: gives vehicles that have no company and model one that suits their type (a
// Hatchback becomes a Swift, i20, Altroz or Baleno), so the board and New Wash show them.
// Only fills empty ones; never changes a model someone picked.
//   cd apps/api && node scripts/seed-vehicle-models.mjs
import { d1Rows, d1Run } from './lib/target.mjs';

const MODELS = {
  'Hatchback': [['Maruti Suzuki', 'Swift'], ['Hyundai', 'i20'], ['Tata', 'Altroz'], ['Maruti Suzuki', 'Baleno']],
  'Sedan': [['Honda', 'City'], ['Hyundai', 'Verna'], ['Maruti Suzuki', 'Dzire']],
  'Compact SUV': [['Tata', 'Nexon'], ['Maruti Suzuki', 'Brezza'], ['Hyundai', 'Venue'], ['Kia', 'Sonet']],
  'SUV': [['Toyota', 'Fortuner'], ['Mahindra', 'XUV700'], ['Tata', 'Harrier'], ['Hyundai', 'Creta']],
  'MUV / 7-seater': [['Toyota', 'Innova Crysta'], ['Maruti Suzuki', 'Ertiga'], ['Kia', 'Carens']],
  'Jeep / Off-roader': [['Mahindra', 'Thar'], ['Maruti Suzuki', 'Jimny'], ['Force', 'Gurkha']],
  'Luxury car': [['Mercedes-Benz', 'C-Class'], ['BMW', '3 Series'], ['Audi', 'A4'], ['Volvo', 'XC60']],
  'Sports car': [['Porsche', '911'], ['Ford', 'Mustang']],
  'Van': [['Maruti Suzuki', 'Eeco'], ['Force', 'Traveller']],
  'Auto rickshaw': [['Bajaj', 'RE Auto'], ['Bajaj', 'Maxima']],
  'Goods auto': [['Piaggio', 'Ape Xtra'], ['Tata', 'Ace']],
  'E-rickshaw': [['Mahindra', 'Treo']],
};

const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const rows = d1Rows(
  `SELECT v.id, v.shop_id, vt.name AS type FROM vehicles v
     JOIN vehicle_types vt ON vt.id = v.vehicle_type_id AND vt.shop_id = v.shop_id
    WHERE v.make IS NULL OR v.model IS NULL
    ORDER BY v.rowid`,
);
const used = {};
const statements = [];
let skipped = 0;
for (const r of rows) {
  const list = MODELS[r.type];
  if (!list) {
    skipped++;
    continue;
  }
  const i = (used[r.type] = (used[r.type] ?? -1) + 1);
  const [make, model] = list[i % list.length];
  statements.push(
    `UPDATE vehicles SET make = ${sq(make)}, model = ${sq(model)}, updated_at = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now') WHERE id = ${sq(r.id)} AND shop_id = ${sq(r.shop_id)};`,
  );
}
for (let i = 0; i < statements.length; i += 50) d1Run(statements.slice(i, i + 50).join('\n'));
console.log(`Gave ${statements.length} vehicles a company and model${skipped ? ` (${skipped} of types with no list left as they are)` : ''}.`);
