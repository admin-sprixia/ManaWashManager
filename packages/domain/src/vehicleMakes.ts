import type { VehicleCategory } from './types';

/**
 * Body styles, named like the vehicle photo catalogue's keys (VEHICLE_CATALOG in @mana/ui), so
 * the app can match a model to the branch's own vehicle types.
 */
export type BodyStyle =
  | 'hatch'
  | 'sedan'
  | 'suvMini'
  | 'suvLarge'
  | 'muv'
  | 'jeep'
  | 'sports'
  | 'pickup'
  | 'van'
  | 'shareVan'
  | 'tempoTraveller'
  | 'auto'
  | 'eRickshaw'
  | 'cargoAuto'
  | 'miniTruck'
  | 'lightTruck'
  | 'scooter'
  | 'eScooter'
  | 'moped'
  | 'bike'
  | 'sportsBike'
  | 'cruiser';

/**
 * Makes and models customers pick from when they add a vehicle, as on Indian roads in late 2026:
 * everything on sale plus the older models a car wash still sees every day (Indica, Santro,
 * EcoSport, Splendor…), each under its body style. Brands that build both cars and two-wheelers
 * (Honda, Suzuki, BMW…) have one entry per category. Customers can still type a make or model
 * that isn't listed.
 */
export interface VehicleMake {
  name: string;
  category: VehicleCategory;
  /** Luxury marques, whose cars go to a branch's "Luxury car" type when it has one. */
  luxury?: boolean;
  models: readonly string[];
  bodies: Readonly<Partial<Record<BodyStyle, readonly string[]>>>;
}

type Bodies = Partial<Record<BodyStyle, string[]>>;

const make = (
  name: string,
  category: VehicleCategory,
  bodies: Bodies,
  luxury?: boolean,
): VehicleMake => ({
  name,
  category,
  ...(luxury ? { luxury } : {}),
  models: Object.values(bodies).flat(),
  bodies,
});
const car = (name: string, bodies: Bodies) => make(name, 'car', bodies);
const luxuryCar = (name: string, bodies: Bodies) => make(name, 'car', bodies, true);
const bike = (name: string, bodies: Bodies) => make(name, 'bike', bodies);

export const VEHICLE_MAKES: readonly VehicleMake[] = [
  // ---------- Cars, vans, autos and light trucks ----------
  car('Maruti Suzuki', {
    hatch: [
      'Alto K10',
      'Alto 800',
      'Alto',
      'S-Presso',
      'Celerio',
      'Wagon R',
      'Ignis',
      'Swift',
      'Baleno',
      'Ritz',
      'A-Star',
      'Zen',
      'Zen Estilo',
      'Estilo',
      '800',
    ],
    sedan: ['Dzire', 'Swift Dzire', 'Dzire Tour', 'Ciaz', 'Esteem', 'SX4', 'Kizashi'],
    suvMini: ['Fronx', 'Brezza', 'Vitara Brezza'],
    suvLarge: ['Grand Vitara', 'Victoris', 'e Vitara', 'S-Cross'],
    muv: ['Ertiga', 'XL6', 'Invicto'],
    jeep: ['Jimny', 'Gypsy'],
    van: ['Eeco', 'Omni', 'Versa'],
    miniTruck: ['Super Carry'],
  }),
  car('Tata', {
    hatch: [
      'Tiago',
      'Tiago EV',
      'Tiago NRG',
      'Altroz',
      'Altroz Racer',
      'Indica',
      'Indica Vista',
      'Nano',
      'Bolt',
    ],
    sedan: ['Aeris', 'Tigor', 'Tigor EV', 'Indigo', 'Indigo CS', 'Indigo Marina', 'Manza', 'Zest'],
    suvMini: ['Punch', 'Punch EV', 'Nexon', 'Nexon EV'],
    suvLarge: [
      'Curvv',
      'Curvv EV',
      'Harrier',
      'Harrier EV',
      'Safari',
      'Sierra',
      'Sierra EV',
      'Safari Storme',
      'Safari Dicor',
    ],
    muv: ['Hexa', 'Aria', 'Sumo', 'Sumo Gold', 'Sumo Grande'],
    van: ['Venture'],
    shareVan: ['Magic', 'Winger'],
    pickup: ['Xenon', 'Yodha', 'Intra'],
    miniTruck: ['Ace', 'Ace EV'],
  }),
  car('Mahindra', {
    hatch: ['e2o'],
    sedan: ['Logan', 'Verito'],
    suvMini: ['XUV 3XO', 'XUV 3XO EV', 'XUV300', 'XUV400', 'KUV100', 'TUV300', 'Bolero Neo'],
    suvLarge: [
      'XUV 7XO',
      'XUV700',
      'XUV500',
      'Scorpio N',
      'Scorpio Classic',
      'Scorpio',
      'Bolero',
      'BE 6',
      'XEV 9e',
      'XEV 9S',
      'Alturas G4',
    ],
    muv: ['Marazzo', 'Xylo', 'Quanto'],
    jeep: ['Thar', 'Thar Roxx', 'Thar OG', 'Jeep'],
    pickup: ['Bolero Pik-Up', 'Bolero Maxx Pik-Up', 'Bolero Camper', 'Imperio'],
    miniTruck: ['Supro', 'Jeeto'],
    auto: ['Alfa', 'e Alfa', 'Treo'],
    cargoAuto: ['Treo Zor', 'Zor Grand'],
  }),
  car('Hyundai', {
    hatch: [
      'Grand i10 Nios',
      'Grand i10',
      'i10',
      'i20',
      'i20 N Line',
      'i20 Active',
      'Santro',
      'Santro Xing',
      'Eon',
      'Getz',
    ],
    sedan: ['Aura', 'Verna', 'Xcent', 'Sonata', 'Elantra', 'Accent'],
    suvMini: ['Exter', 'Venue', 'Venue N Line', 'Kona Electric'],
    suvLarge: [
      'Bayon',
      'Creta',
      'Creta N Line',
      'Creta Electric',
      'Alcazar',
      'Tucson',
      'Ioniq 5',
      'Santa Fe',
    ],
  }),
  car('Kia', {
    suvMini: ['Sonet', 'Syros'],
    suvLarge: ['Seltos', 'Sorento', 'EV6', 'EV9'],
    muv: ['Carens', 'Carens Clavis', 'Carens Clavis EV', 'Carnival'],
  }),
  car('Toyota', {
    hatch: ['Glanza', 'Etios Liva', 'Etios Cross'],
    sedan: ['Etios', 'Corolla', 'Corolla Altis', 'Camry', 'Yaris', 'Prius'],
    suvMini: ['Taisor', 'Urban Cruiser'],
    suvLarge: [
      'Urban Cruiser Hyryder',
      'Urban Cruiser Ebella',
      'Fortuner',
      'Fortuner Legender',
      'Land Cruiser',
      'Land Cruiser Prado',
    ],
    muv: ['Rumion', 'Innova Crysta', 'Innova Hycross', 'Innova', 'Vellfire', 'Qualis'],
    pickup: ['Hilux'],
  }),
  car('Honda', {
    hatch: ['Jazz', 'Brio'],
    sedan: ['Amaze', 'City', 'City e:HEV', 'City ZX', 'Civic', 'Accord'],
    suvMini: ['WR-V'],
    suvLarge: ['Elevate', 'ZR-V', 'CR-V'],
    muv: ['Mobilio', 'BR-V'],
  }),
  car('MG', {
    hatch: ['Comet EV'],
    suvMini: ['Windsor EV'],
    suvLarge: [
      'ZS EV',
      'Astor',
      'Hector',
      'Hector Plus',
      'Hector Tomahawk EV',
      'Hector Tomahawk PHEV',
      'Gloster',
      'Majestor',
    ],
    muv: ['M9'],
    sports: ['Cyberster'],
  }),
  car('Renault', {
    hatch: ['Kwid', 'Pulse'],
    sedan: ['Scala', 'Fluence'],
    suvMini: ['Kiger'],
    suvLarge: ['Duster', 'Captur'],
    muv: ['Triber', 'Lodgy'],
  }),
  car('Nissan', {
    hatch: ['Micra'],
    sedan: ['Sunny', 'Teana'],
    suvMini: ['Magnite'],
    suvLarge: ['X-Trail', 'Kicks', 'Terrano'],
    muv: ['Evalia'],
  }),
  car('Skoda', {
    hatch: ['Fabia'],
    sedan: ['Slavia', 'Superb', 'Octavia', 'Rapid', 'Laura'],
    suvMini: ['Kylaq'],
    suvLarge: ['Kushaq', 'Kodiaq', 'Enyaq', 'Yeti'],
  }),
  car('Volkswagen', {
    hatch: ['Polo', 'Polo GT', 'Cross Polo'],
    sedan: ['Virtus', 'Vento', 'Ameo', 'Jetta', 'Passat'],
    suvLarge: ['Taigun', 'Tiguan', 'Tayron', 'ID.4'],
  }),
  car('Citroën', {
    hatch: ['C3', 'eC3'],
    suvMini: ['Basalt'],
    suvLarge: ['C3 Aircross', 'C5 Aircross'],
  }),
  car('Jeep', {
    suvLarge: ['Compass', 'Meridian', 'Grand Cherokee'],
    jeep: ['Wrangler'],
  }),
  car('Ford', {
    hatch: ['Figo', 'Freestyle', 'Fusion'],
    sedan: ['Figo Aspire', 'Fiesta', 'Fiesta Classic', 'Ikon'],
    suvMini: ['EcoSport'],
    suvLarge: ['Endeavour'],
  }),
  car('Chevrolet', {
    hatch: ['Beat', 'Spark', 'Sail U-VA'],
    sedan: ['Cruze', 'Sail', 'Aveo', 'Optra'],
    suvLarge: ['Trailblazer', 'Captiva'],
    muv: ['Enjoy', 'Tavera'],
  }),
  car('Mitsubishi', {
    sedan: ['Lancer', 'Cedia'],
    suvLarge: ['Pajero', 'Pajero Sport', 'Montero', 'Outlander'],
  }),
  car('Datsun', { hatch: ['redi-GO', 'GO'], muv: ['GO+'] }),
  car('Fiat', {
    hatch: ['Punto', 'Grande Punto', 'Palio', 'Uno'],
    sedan: ['Linea', 'Petra', 'Siena'],
    suvMini: ['Avventura'],
  }),
  car('Opel', { sedan: ['Corsa', 'Astra', 'Vectra'] }),
  car('Daewoo', { hatch: ['Matiz'], sedan: ['Cielo', 'Nexia'] }),
  car('Premier', { suvMini: ['Rio'], sedan: ['Padmini'] }),
  car('Force', {
    jeep: ['Gurkha'],
    muv: ['Trax Cruiser'],
    tempoTraveller: ['Traveller', 'Urbania'],
  }),
  car('Isuzu', { pickup: ['D-Max V-Cross', 'D-Max'], suvLarge: ['MU-X'] }),
  car('BYD', { sedan: ['Seal'], suvLarge: ['Atto 3', 'Sealion 7'], muv: ['eMAX 7', 'e6'] }),
  car('Tesla', { sedan: ['Model 3'], suvLarge: ['Model Y'] }),
  car('VinFast', { hatch: ['VF 3'], suvLarge: ['VF 6', 'VF 7'] }),
  luxuryCar('Mercedes-Benz', {
    sedan: ['A-Class Limousine', 'C-Class', 'E-Class', 'S-Class', 'EQE', 'EQS', 'Maybach'],
    suvLarge: ['GLA', 'GLC', 'GLE', 'GLS', 'G-Class', 'EQA', 'EQB'],
    sports: ['AMG GT'],
  }),
  luxuryCar('BMW', {
    sedan: ['2 Series Gran Coupe', '3 Series', '5 Series', '7 Series', 'i4', 'i5', 'i7', 'M340i'],
    suvLarge: ['X1', 'X3', 'X5', 'X7', 'iX', 'iX1'],
    sports: ['Z4'],
  }),
  luxuryCar('Audi', {
    sedan: ['A4', 'A6', 'A8', 'e-tron GT'],
    suvLarge: ['Q3', 'Q5', 'Q7', 'Q8', 'e-tron', 'RS Q8'],
  }),
  luxuryCar('Volvo', {
    sedan: ['S60', 'S90', 'ES90'],
    suvLarge: ['XC40', 'XC60', 'XC90', 'EX30', 'EX40', 'EX90'],
  }),
  luxuryCar('Land Rover', {
    suvLarge: [
      'Defender',
      'Discovery',
      'Discovery Sport',
      'Range Rover',
      'Range Rover Sport',
      'Range Rover Velar',
      'Range Rover Evoque',
    ],
  }),
  luxuryCar('Jaguar', { sedan: ['XE', 'XF'], suvLarge: ['F-Pace', 'I-Pace'] }),
  luxuryCar('Lexus', { sedan: ['ES'], suvLarge: ['NX', 'RX', 'LX'], muv: ['LM'] }),
  luxuryCar('Porsche', {
    sedan: ['Panamera', 'Taycan'],
    suvLarge: ['Macan', 'Cayenne'],
    sports: ['911'],
  }),
  car('Mini', { hatch: ['Cooper'], suvMini: ['Countryman'] }),
  luxuryCar('Lamborghini', { suvLarge: ['Urus'], sports: ['Huracán', 'Revuelto'] }),
  luxuryCar('Ferrari', { sports: ['Roma', '296'], suvLarge: ['Purosangue'] }),
  luxuryCar('Rolls-Royce', { sedan: ['Ghost', 'Phantom'], suvLarge: ['Cullinan'] }),
  luxuryCar('Bentley', { suvLarge: ['Bentayga'], sports: ['Continental GT'] }),
  car('Hindustan Motors', { sedan: ['Ambassador'] }),
  car('Ashok Leyland', { miniTruck: ['Dost', 'Bada Dost'], lightTruck: ['Partner'] }),
  car('Bajaj', { auto: ['RE Auto', 'Maxima'], hatch: ['Qute'] }),
  car('Piaggio', { auto: ['Ape Auto', 'Ape City', 'Ape E-City'], cargoAuto: ['Ape Xtra'] }),
  car('TVS', { auto: ['King'], cargoAuto: ['King Kargo'] }),
  car('Atul', { auto: ['Gem', 'Shakti'], eRickshaw: ['Rik'] }),

  // ---------- Two-wheelers ----------
  bike('Hero', {
    bike: [
      'Splendor',
      'Splendor Plus',
      'Splendor Plus Xtec',
      'Splendor NXG',
      'Super Splendor',
      'Super Splendor Xtec',
      'HF Deluxe',
      'HF 100',
      'HF Dawn',
      'CD Deluxe',
      'Passion',
      'Passion Plus',
      'Passion Pro',
      'Passion Xtec',
      'Ambition',
      'Glamour',
      'Glamour Xtec',
      'Xtreme 125R',
      'Xtreme 160R',
      'Xtreme 160R 4V',
      'Xtreme 250R',
      'Xpulse 200 4V',
      'Xpulse 210',
      'Mavrick 440',
      'Achiever',
      'Ignitor',
      'Hunk',
      'CBZ',
      'Impulse',
    ],
    sportsBike: ['Xtreme 200S', 'Karizma', 'Karizma ZMR', 'Karizma XMR'],
    scooter: [
      'Pleasure',
      'Pleasure Plus',
      'Destini 125',
      'Destini 110',
      'Xoom 110',
      'Xoom 125',
      'Xoom 160',
      'Maestro',
      'Maestro Edge',
      'Duet',
    ],
  }),
  bike('Vida', { eScooter: ['VX2', 'V2', 'V1'] }),
  bike('Honda', {
    scooter: [
      'Activa',
      'Activa 125',
      'Dio',
      'Dio 125',
      'Grazia',
      'Aviator',
      'Navi',
      'Cliq',
      'Eterno',
      'ADV 160',
    ],
    eScooter: ['Activa e', 'QC1', 'QC3'],
    bike: [
      'Shine 100',
      'Shine 125',
      'SP 125',
      'SP 160',
      'Livo',
      'Dream Yuga',
      'CD 110 Dream',
      'Unicorn',
      'CB Unicorn 160',
      'CB Trigger',
      'CB 125 Hornet',
      'Hornet 2.0',
      'X-Blade',
      'CB200X',
      'CB300R',
      'CB300F',
      'NX200',
      'NX500',
      'XR 300L',
      'XR 300 Rally',
      'Africa Twin',
      'Twister',
      'Stunner',
    ],
    sportsBike: ['CBR 150R', 'CBR 250R', 'CBR650R'],
    cruiser: [
      "H'ness CB350",
      'CB350',
      'CB350RS',
      'CB350C',
      'CB 500',
      'Rebel 300',
      'Rebel 500',
      'Gold Wing',
    ],
  }),
  bike('TVS', {
    scooter: [
      'Jupiter',
      'Jupiter 125',
      'Ntorq 125',
      'Ntorq 150',
      'Zest 110',
      'Scooty Pep Plus',
      'Scooty Streak',
      'Wego',
    ],
    eScooter: ['iQube', 'Orbiter', 'X'],
    moped: ['XL100'],
    bike: [
      'Jive',
      'Max 100',
      'Sport',
      'Radeon',
      'Star City Plus',
      'Raider 125',
      'Apache RTR 160',
      'Apache RTR 160 4V',
      'Apache RTR 165RP',
      'Apache RTR 180',
      'Apache RTR 200 4V',
      'Apache RTR 310',
      'Phoenix',
      'Victor',
      'Centra',
      'Fiero',
      'Flame',
    ],
    sportsBike: ['Apache RR 310'],
    cruiser: ['Ronin'],
  }),
  bike('Bajaj', {
    bike: [
      'Pulsar 125',
      'Pulsar 135 LS',
      'Pulsar 150',
      'Pulsar 180',
      'Pulsar N125',
      'Pulsar N150',
      'Pulsar N160',
      'Pulsar N160 S',
      'Pulsar NS125',
      'Pulsar NS160',
      'Pulsar NS200',
      'Pulsar NS400Z',
      'Pulsar N250',
      'Platina 100',
      'Platina 110',
      'CT 100',
      'CT 110',
      'CT 125X',
      'Freedom 125',
      'Dominar 250',
      'Dominar 400',
      'Discover',
      'Discover 125',
      'XCD',
      'Caliber',
      'Boxer',
      'V15',
    ],
    sportsBike: ['Pulsar 220F', 'Pulsar RS200', 'Pulsar F250'],
    cruiser: ['Avenger Street 160', 'Avenger Street 220', 'Avenger Cruise 220'],
    eScooter: ['Chetak'],
    scooter: ['Kristal'],
  }),
  bike('Royal Enfield', {
    cruiser: [
      'Classic 350',
      'Classic 500',
      'Bullet 350',
      'Bullet 500',
      'Hunter 350',
      'Meteor 350',
      'Goan Classic 350',
      'Interceptor 650',
      'Continental GT 650',
      'Super Meteor 650',
      'Shotgun 650',
      'Bear 650',
      'Classic 650',
      'Thunderbird',
      'Thunderbird X',
      'Electra',
    ],
    bike: [
      'Himalayan 411',
      'Himalayan 450',
      'Guerrilla 450',
      'Scram 411',
      'Scram 440',
      'Flying Flea C6',
    ],
  }),
  bike('Yamaha', {
    bike: [
      'FZ-S Fi',
      'FZ Fi',
      'FZ-X',
      'FZ-S Fi Hybrid',
      'FZ25',
      'Fazer',
      'Fazer 25',
      'MT-15',
      'XSR 155',
      'MT-03',
      'MT-09',
      'Saluto',
      'SZ-R',
      'SZ-RR',
      'YBR 125',
      'Gladiator',
      'Crux',
      'Libero',
      'Enticer',
      'RX 100',
      'RX 135',
      'FZ16',
    ],
    sportsBike: ['R15 V3', 'R15 V4', 'R15M', 'R15S', 'YZF-R2', 'R3', 'YZF-R1'],
    scooter: ['Aerox 155', 'RayZR 125', 'Ray', 'Fascino 125', 'Alpha'],
    eScooter: ['Aerox E', 'EC-06'],
  }),
  bike('Suzuki', {
    scooter: [
      'Access 125',
      'Burgman Street 125',
      'Burgman Street EX',
      'Avenis 125',
      "Let's",
      'Swish',
    ],
    eScooter: ['e-Access'],
    bike: [
      'Gixxer',
      'Gixxer 250',
      'V-Strom SX',
      'V-Strom 800DE',
      'Hayate',
      'Slingshot',
      'Zeus',
      'Heat',
      'GS150R',
      'Samurai',
      'Shogun',
    ],
    sportsBike: ['Gixxer SF', 'Gixxer SF 250', 'Hayabusa'],
    cruiser: ['Intruder'],
  }),
  bike('KTM', {
    bike: [
      '125 Duke',
      '160 Duke',
      '200 Duke',
      '250 Duke',
      '390 Duke',
      '250 Adventure',
      '390 Adventure',
      '390 Adventure R',
      '390 Enduro R',
    ],
    sportsBike: ['RC 125', 'RC 160', 'RC 200', 'RC 390'],
  }),
  bike('Ather', { eScooter: ['Rizta', '450X', '450S', '450 Apex', '450 Plus'] }),
  bike('Ola', {
    eScooter: ['S1 Pro', 'S1 Air', 'S1 X', 'S1 Z', 'Gig'],
    bike: ['Roadster X', 'Roadster'],
  }),
  bike('Jawa', { cruiser: ['42', '350', '42 Bobber', '42 FJ', 'Perak'] }),
  bike('Yezdi', { cruiser: ['Roadster'], bike: ['Scrambler', 'Adventure'] }),
  bike('BSA', { cruiser: ['Gold Star 650'] }),
  bike('Kawasaki', {
    sportsBike: ['Ninja 300', 'Ninja 400', 'Ninja 500', 'Ninja 650', 'Ninja ZX-10R'],
    bike: ['Z650', 'Z900', 'Versys 650', 'W175', 'KLX 230'],
    cruiser: ['Vulcan S', 'Eliminator'],
  }),
  bike('Triumph', {
    bike: [
      'Speed 400',
      'Scrambler 400 X',
      'Speed T4',
      'Trident 660',
      'Street Triple',
      'Speed Twin',
      'Tiger 660',
      'Tiger 900',
    ],
    cruiser: ['Bonneville'],
  }),
  bike('Harley-Davidson', {
    cruiser: [
      'X440',
      'Street 750',
      'Street Rod',
      'Iron 883',
      'Forty-Eight',
      'Nightster',
      'Sportster S',
      'Fat Boy',
    ],
  }),
  bike('BMW', {
    bike: ['G 310 R', 'G 310 GS', 'F 900 GS', 'R 1300 GS'],
    sportsBike: ['G 310 RR', 'S 1000 RR'],
    eScooter: ['CE 04'],
  }),
  bike('Ducati', {
    bike: ['Monster', 'Scrambler', 'Multistrada V2'],
    sportsBike: ['Panigale V2'],
  }),
  bike('Aprilia', {
    scooter: ['SR 125', 'SR 160', 'Storm 125'],
    sportsBike: ['RS 457'],
    bike: ['Tuono 457'],
  }),
  bike('Vespa', { scooter: ['VXL 125', 'SXL 125', 'VXL 150', 'SXL 150', 'Elegante'] }),
  bike('Husqvarna', { bike: ['Svartpilen 250', 'Svartpilen 401', 'Vitpilen 250'] }),
  bike('Benelli', { bike: ['TNT 300', 'TRK 502', 'Leoncino 500'], cruiser: ['Imperiale 400'] }),
  bike('Keeway', { cruiser: ['K-Light 250V'], bike: ['SR 125'], scooter: ['Vieste 300'] }),
  bike('QJ Motor', { bike: ['SRC 500'], cruiser: ['SRV 300'] }),
  bike('Hyosung', { sportsBike: ['GT250R'], cruiser: ['Aquila'] }),
  bike('LML', { scooter: ['NV', 'Select'], bike: ['Freedom'] }),
  bike('Kinetic', { scooter: ['Kinetic Honda', 'Zing', 'Blaze', 'Nova'], moped: ['Luna'] }),
  bike('Ampere', { eScooter: ['Magnus', 'Nexus', 'Reo', 'Primus'] }),
  bike('Okinawa', { eScooter: ['Praise', 'iPraise', 'Ridge'] }),
  bike('Revolt', { bike: ['RV400', 'RV1', 'RV BlazeX'] }),
  bike('Ultraviolette', { sportsBike: ['F77'], eScooter: ['Tesseract'] }),
  bike('Simple Energy', { eScooter: ['One'] }),
  bike('River', { eScooter: ['Indie'] }),
  bike('Bounce', { eScooter: ['Infinity E1'] }),
  bike('Kinetic Green', { moped: ['E-Luna'], eScooter: ['Zing'] }),
  bike('Pure EV', { eScooter: ['ePluto 7G'], bike: ['EcoDryft'] }),
  bike('Hero Electric', { eScooter: ['Optima', 'Photon', 'Flash'] }),
  bike('BGauss', { eScooter: ['C12', 'RUV 350'] }),
  bike('Lectrix', { eScooter: ['SX25', 'LXS'] }),
  bike('Okaya', { eScooter: ['Faast F2B', 'Freedum'] }),
  bike('Oben', { bike: ['Rorr', 'Rorr EZ'] }),
  bike('Matter', { bike: ['Aera'] }),
  bike('Tork', { bike: ['Kratos R'] }),
  bike('Komaki', { eScooter: ['Venice', 'SE', 'XGT'] }),
  bike('iVoomi', { eScooter: ['JeetX', 'S1'] }),
  bike('Odysse', { bike: ['Evoqis', 'Vader'], eScooter: ['Hawk'] }),
  bike('Yulu', { eScooter: ['Wynn', 'Miracle'] }),
  bike('Mahindra', { bike: ['Mojo', 'Centuro'], scooter: ['Gusto', 'Rodeo', 'Duro'] }),
];

/**
 * For each body style, the vehicle types to look for in a branch's list, best first: a branch
 * without "Compact SUV" still has the nearest fit for a Brezza.
 */
export const BODY_STYLE_FALLBACKS: Readonly<Record<BodyStyle, readonly string[]>> = {
  hatch: ['hatch', 'sedan'],
  sedan: ['sedan', 'hatch'],
  suvMini: ['suvMini', 'suvLarge', 'hatch'],
  suvLarge: ['suvLarge', 'suvMini', 'muv'],
  muv: ['muv', 'suvLarge', 'suvMini'],
  jeep: ['jeep', 'suvLarge', 'suvMini'],
  sports: ['sports', 'luxury', 'sedan'],
  pickup: ['pickup', 'miniTruck', 'suvLarge'],
  van: ['van', 'shareVan', 'muv', 'suvLarge'],
  shareVan: ['shareVan', 'van', 'tempoTraveller'],
  tempoTraveller: ['tempoTraveller', 'bus', 'shareVan', 'van'],
  auto: ['auto', 'eRickshaw', 'cargoAuto'],
  eRickshaw: ['eRickshaw', 'auto'],
  cargoAuto: ['cargoAuto', 'auto', 'miniTruck'],
  miniTruck: ['miniTruck', 'pickup', 'lightTruck', 'cargoAuto'],
  lightTruck: ['lightTruck', 'miniTruck', 'truck'],
  scooter: ['scooter', 'eScooter', 'moped', 'bike'],
  eScooter: ['eScooter', 'scooter', 'moped', 'bike'],
  moped: ['moped', 'scooter', 'bike'],
  bike: ['bike', 'sportsBike', 'cruiser'],
  sportsBike: ['sportsBike', 'bike', 'cruiser'],
  cruiser: ['cruiser', 'bike', 'sportsBike'],
};

const PASSENGER_CAR: ReadonlySet<BodyStyle> = new Set([
  'hatch',
  'sedan',
  'suvMini',
  'suvLarge',
  'muv',
  'jeep',
  'sports',
]);

const sortByName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Make names for a category, A to Z; both categories merged when it isn't known yet. */
export function vehicleMakeNames(category?: VehicleCategory | null): string[] {
  const names = VEHICLE_MAKES.filter((m) => !category || m.category === category).map(
    (m) => m.name,
  );
  return [...new Set(names)].sort(sortByName);
}

/** A make's models, A to Z (both categories when it isn't known); empty for a make we don't list. */
export function vehicleModelNames(make: string, category?: VehicleCategory | null): string[] {
  const models = VEHICLE_MAKES.filter(
    (m) => same(m.name, make) && (!category || m.category === category),
  ).flatMap((m) => m.models);
  return [...new Set(models)].sort(sortByName);
}

/**
 * The vehicle types that suit a listed make and model, best first (photo catalogue keys), or null
 * for a make or model we don't list. Luxury marques' cars try "luxury" before their body style.
 */
export function vehicleTypeKeysFor(make: string, model: string): string[] | null {
  for (const m of VEHICLE_MAKES) {
    if (!same(m.name, make)) continue;
    for (const [body, models] of Object.entries(m.bodies) as [BodyStyle, readonly string[]][]) {
      if (!models.some((x) => same(x, model))) continue;
      const keys = BODY_STYLE_FALLBACKS[body];
      return m.luxury && PASSENGER_CAR.has(body) && body !== 'sports'
        ? ['luxury', ...keys]
        : [...keys];
    }
  }
  return null;
}
