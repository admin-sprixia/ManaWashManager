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
  | 'cruiser'
  | 'premiumBike'
  | 'bus'
  | 'truck'
  | 'lorry'
  | 'tipper'
  | 'tanker'
  | 'trailer'
  | 'tractor'
  | 'earthmover';

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
      'Wagon R Stingray',
      'Celerio X',
      'Swift Sport',
      'Alto LXi',
      'Maruti 800',
    ],
    sedan: [
      'Dzire',
      'Swift Dzire',
      'Dzire Tour',
      'Ciaz',
      'Esteem',
      'SX4',
      'Kizashi',
      'Baleno Sedan',
      'Maruti 1000',
    ],
    suvMini: ['Fronx', 'Brezza', 'Vitara Brezza'],
    suvLarge: ['Grand Vitara', 'Victoris', 'e Vitara', 'S-Cross'],
    muv: ['Ertiga', 'XL6', 'Invicto', 'Ertiga Tour'],
    jeep: ['Jimny', 'Gypsy', 'Gypsy King'],
    van: ['Eeco', 'Omni', 'Versa', 'Eeco Cargo'],
    miniTruck: ['Super Carry'],
    pickup: ['Super Carry Pickup'],
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
      'Indica eV2',
      'Indica V2',
    ],
    sedan: ['Aeris', 'Tigor', 'Tigor EV', 'Indigo', 'Indigo CS', 'Indigo Marina', 'Manza', 'Zest'],
    suvMini: ['Punch', 'Punch EV', 'Nexon', 'Nexon EV', 'Nexon iCNG', 'Punch iCNG'],
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
      'Safari EV',
      'Sumo Victa',
    ],
    muv: ['Hexa', 'Aria', 'Sumo', 'Sumo Gold', 'Sumo Grande', 'Movus', 'Spacio'],
    van: ['Venture'],
    shareVan: ['Magic', 'Winger', 'Magic Express', 'Magic Iris', 'Winger Plus'],
    pickup: [
      'Xenon',
      'Yodha',
      'Intra',
      'Intra V10',
      'Intra V30',
      'Intra V50',
      'Intra V70',
      'Yodha 2.0',
      'Super Ace',
    ],
    miniTruck: ['Ace', 'Ace EV', 'Ace Gold', 'Ace HT+', 'Ace Zip', 'Ace Pro'],
    lightTruck: [
      '407',
      '407 Gold',
      'LPT 709',
      'LPT 710',
      'LPT 1109',
      'Ultra T.7',
      'Ultra T.9',
      'Ultra T.11',
    ],
    truck: ['LPT 1212', 'LPT 1613', 'LPT 1618', 'Ultra T.16', 'Signa 1923'],
    lorry: ['LPT 2518', 'LPT 3118', 'Signa 2823', 'Signa 3523', 'Signa 4223', 'Prima 4028'],
    tipper: ['LPK 2518', 'Signa 2825.K', 'Signa 2830.K', 'Prima 2830.K'],
    tanker: ['LPT 1613 Tanker', 'Signa 2823 Tanker'],
    trailer: ['Signa 4825.T', 'Signa 5530.S', 'Prima 5530.S'],
    bus: ['Starbus', 'Starbus Ultra', 'Cityride', 'Magna', 'Ultra Bus', 'Marcopolo'],
  }),
  car('Mahindra', {
    hatch: ['e2o'],
    sedan: ['Logan', 'Verito'],
    suvMini: [
      'XUV 3XO',
      'XUV 3XO EV',
      'XUV300',
      'XUV400',
      'KUV100',
      'TUV300',
      'Bolero Neo',
      'NuvoSport',
      'Bolero Power+',
    ],
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
      'BE 6 Formula E',
      'XUV 9e',
      'Scorpio Getaway',
    ],
    muv: ['Marazzo', 'Xylo', 'Quanto', 'Marshal', 'Commander', 'Major'],
    jeep: ['Thar', 'Thar Roxx', 'Thar OG', 'Jeep'],
    pickup: [
      'Bolero Pik-Up',
      'Bolero Maxx Pik-Up',
      'Bolero Camper',
      'Imperio',
      'Maxx Pik-Up',
      'Veero',
      'Scorpio Pik-Up',
      'Bolero Neo+',
    ],
    miniTruck: ['Supro', 'Jeeto', 'Maxximo', 'Jeeto Plus', 'Supro Profit Truck'],
    auto: ['Alfa', 'e Alfa', 'Treo', 'Alfa Plus', 'Treo Plus', 'e Alfa Mini'],
    cargoAuto: ['Treo Zor', 'Zor Grand'],
    lightTruck: ['Furio 7', 'Furio 11', 'Loadking Optimo'],
    truck: ['Furio 14', 'Furio 16', 'Blazo X 25'],
    lorry: ['Blazo X 28', 'Blazo X 35', 'Blazo X 42'],
    tipper: ['Blazo X 28 Tipper', 'Torro 25'],
    trailer: ['Blazo X 46', 'Blazo X 55'],
    bus: ['Cruzio', 'Tourister'],
    tractor: [
      '265 DI',
      '275 DI',
      '275 DI TU',
      '415 DI',
      '475 DI',
      '575 DI',
      '585 DI',
      'Arjun Novo 605',
      'Arjun 555',
      'Yuvo 575',
      'Yuvo Tech+ 585',
      'Jivo 245',
      'Jivo 305',
      'OJA 2127',
      'OJA 3140',
      'Novo 755',
      'Sarpanch 575',
    ],
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
      'Elite i20',
      'Grand i10 Prime',
      'i10 Kappa',
    ],
    sedan: [
      'Aura',
      'Verna',
      'Xcent',
      'Sonata',
      'Elantra',
      'Accent',
      'Fluidic Verna',
      'Xcent Prime',
      'Verna Fluidic',
      'Ioniq 6',
    ],
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
      'Terracan',
      'Tucson (old)',
    ],
  }),
  car('Kia', {
    suvMini: ['Sonet', 'Syros', 'Clavis'],
    suvLarge: ['Seltos', 'Sorento', 'EV6', 'EV9', 'Seltos X-Line', 'EV5'],
    muv: ['Carens', 'Carens Clavis', 'Carens Clavis EV', 'Carnival'],
  }),
  car('Toyota', {
    hatch: ['Glanza', 'Etios Liva', 'Etios Cross'],
    sedan: [
      'Etios',
      'Corolla',
      'Corolla Altis',
      'Camry',
      'Yaris',
      'Prius',
      'Camry Hybrid',
      'Corolla Altis Hybrid',
    ],
    suvMini: ['Taisor', 'Urban Cruiser'],
    suvLarge: [
      'Urban Cruiser Hyryder',
      'Urban Cruiser Ebella',
      'Fortuner',
      'Fortuner Legender',
      'Land Cruiser',
      'Land Cruiser Prado',
      'Land Cruiser 300',
      'Land Cruiser 200',
      'Hyryder',
    ],
    muv: [
      'Rumion',
      'Innova Crysta',
      'Innova Hycross',
      'Innova',
      'Vellfire',
      'Qualis',
      'Innova Crysta Touring Sport',
      'Alphard',
    ],
    pickup: ['Hilux'],
    tempoTraveller: ['Hiace', 'Commuter'],
  }),
  car('Honda', {
    hatch: ['Jazz', 'Brio', 'Brio Amaze'],
    sedan: [
      'Amaze',
      'City',
      'City e:HEV',
      'City ZX',
      'Civic',
      'Accord',
      'Civic Hybrid',
      'Accord Hybrid',
      'City Hybrid',
    ],
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
      'Hector Blackstorm',
      'Gloster Blackstorm',
    ],
    muv: ['M9'],
    sports: ['Cyberster'],
  }),
  car('Renault', {
    hatch: ['Kwid', 'Pulse', 'Kwid EV'],
    sedan: ['Scala', 'Fluence'],
    suvMini: ['Kiger'],
    suvLarge: ['Duster', 'Captur', 'Koleos', 'Boreal'],
    muv: ['Triber', 'Lodgy'],
  }),
  car('Nissan', {
    hatch: ['Micra', 'Micra Active'],
    sedan: ['Sunny', 'Teana'],
    suvMini: ['Magnite'],
    suvLarge: ['X-Trail', 'Kicks', 'Terrano', 'Kicks e-Power', 'Tekton'],
    muv: ['Evalia'],
    sports: ['GT-R', '370Z'],
  }),
  car('Skoda', {
    hatch: ['Fabia'],
    sedan: ['Slavia', 'Superb', 'Octavia', 'Rapid', 'Laura', 'Octavia RS', 'Superb Sportline'],
    suvMini: ['Kylaq'],
    suvLarge: ['Kushaq', 'Kodiaq', 'Enyaq', 'Yeti', 'Elroq', 'Kodiaq Sportline'],
  }),
  car('Volkswagen', {
    hatch: ['Polo', 'Polo GT', 'Cross Polo', 'Golf GTI', 'Beetle', 'Jetta GTI'],
    sedan: ['Virtus', 'Vento', 'Ameo', 'Jetta', 'Passat'],
    suvLarge: [
      'Taigun',
      'Tiguan',
      'Tayron',
      'ID.4',
      'T-Roc',
      'Tiguan Allspace',
      'Tiguan R-Line',
      'Touareg',
    ],
  }),
  car('Citroën', {
    hatch: ['C3', 'eC3'],
    suvMini: ['Basalt'],
    suvLarge: ['C3 Aircross', 'C5 Aircross', 'Aircross', 'Aircross X'],
  }),
  car('Jeep', {
    suvLarge: ['Compass', 'Meridian', 'Grand Cherokee', 'Compass Trailhawk', 'Grand Cherokee L'],
    jeep: ['Wrangler'],
  }),
  car('Ford', {
    hatch: ['Figo', 'Freestyle', 'Fusion'],
    sedan: ['Figo Aspire', 'Fiesta', 'Fiesta Classic', 'Ikon', 'Escort', 'Mondeo'],
    suvMini: ['EcoSport'],
    suvLarge: ['Endeavour', 'Kuga', 'Everest'],
    sports: ['Mustang'],
  }),
  car('Chevrolet', {
    hatch: ['Beat', 'Spark', 'Sail U-VA', 'Aveo U-VA', 'Spark (old)'],
    sedan: ['Cruze', 'Sail', 'Aveo', 'Optra'],
    suvLarge: ['Trailblazer', 'Captiva', 'Forester'],
    muv: ['Enjoy', 'Tavera', 'Enjoy (7 seater)'],
  }),
  car('Mitsubishi', {
    sedan: ['Lancer', 'Cedia'],
    suvLarge: ['Pajero', 'Pajero Sport', 'Montero', 'Outlander', 'Pajero SFX', 'Montero Sport'],
  }),
  car('Datsun', {
    hatch: ['redi-GO', 'GO', 'redi-GO+'],
    muv: ['GO+'],
  }),
  car('Fiat', {
    hatch: ['Punto', 'Grande Punto', 'Palio', 'Uno', 'Punto Evo', 'Abarth Punto'],
    sedan: ['Linea', 'Petra', 'Siena'],
    suvMini: ['Avventura', 'Urban Cross'],
  }),
  car('Opel', { sedan: ['Corsa', 'Astra', 'Vectra'] }),
  car('Daewoo', { hatch: ['Matiz'], sedan: ['Cielo', 'Nexia'] }),
  car('Premier', {
    suvMini: ['Rio'],
    sedan: ['Padmini', '118NE', 'President'],
  }),
  car('Force', {
    jeep: ['Gurkha', 'Gurkha 5-door'],
    muv: ['Trax Cruiser', 'Trax Toofan', 'Trax Cruiser Deluxe'],
    tempoTraveller: ['Traveller', 'Urbania', 'Traveller 3350', 'Traveller 26', 'Monobus'],
    suvLarge: ['One'],
    shareVan: ['Citiline', 'Kargo King'],
    bus: ['Traveller School Bus'],
    tractor: ['Orchard', 'Balwan', 'Sanman'],
  }),
  car('Isuzu', {
    pickup: ['D-Max V-Cross', 'D-Max', 'Hi-Lander', 'S-CAB', 'D-Max Regular Cab'],
    suvLarge: ['MU-X', 'MU-7'],
  }),
  car('BYD', {
    sedan: ['Seal'],
    suvLarge: ['Atto 3', 'Sealion 7', 'Sealion 6', 'Atto 2'],
    muv: ['eMAX 7', 'e6'],
  }),
  car('Tesla', {
    sedan: ['Model 3'],
    suvLarge: ['Model Y', 'Model Y Long Range'],
  }),
  car('VinFast', { hatch: ['VF 3'], suvLarge: ['VF 6', 'VF 7'] }),
  luxuryCar('Mercedes-Benz', {
    sedan: [
      'A-Class Limousine',
      'C-Class',
      'E-Class',
      'S-Class',
      'EQE',
      'EQS',
      'Maybach',
      'CLA',
      'C-Class Long',
      'E-Class LWB',
      'Maybach S-Class',
      'AMG C 63',
      'AMG E 53',
      'AMG S 63',
    ],
    suvLarge: [
      'GLA',
      'GLC',
      'GLE',
      'GLS',
      'G-Class',
      'EQA',
      'EQB',
      'GLB',
      'GLC Coupe',
      'GLE Coupe',
      'EQE SUV',
      'EQS SUV',
      'Maybach GLS',
      'AMG GLA 35',
      'AMG GLC 43',
      'AMG GLE 53',
      'AMG G 63',
      'G 580 EQ',
    ],
    sports: ['AMG GT', 'AMG SL 55', 'AMG GT 63', 'AMG GT Coupe', 'CLE Cabriolet', 'SLK', 'SLC'],
    hatch: ['A-Class', 'B-Class'],
    muv: ['V-Class'],
  }),
  luxuryCar('BMW', {
    hatch: ['1 Series'],
    sedan: [
      '2 Series Gran Coupe',
      '3 Series',
      '3 Series Gran Limousine',
      '3 Series GT',
      '5 Series',
      '6 Series GT',
      '7 Series',
      'i4',
      'i5',
      'i7',
      'M340i',
      'M8 Gran Coupe',
      'i7 M70',
    ],
    suvLarge: [
      'X1',
      'X3',
      'X4',
      'X5',
      'X6',
      'X7',
      'iX',
      'iX1',
      'X3 M',
      'X5 M',
      'XM',
      'X5 M Competition',
      'iX3',
    ],
    sports: ['Z4', 'M2', 'M3', 'M4', 'M5', 'M8', '8 Series'],
  }),
  luxuryCar('Audi', {
    sedan: [
      'A4',
      'A6',
      'A8',
      'e-tron GT',
      'A3 Sedan',
      'A5 Sportback',
      'A7',
      'S5 Sportback',
      'RS5',
      'RS7',
      'RS e-tron GT',
    ],
    suvLarge: [
      'Q3',
      'Q5',
      'Q7',
      'Q8',
      'e-tron',
      'RS Q8',
      'Q4 e-tron',
      'Q6 e-tron',
      'Q8 e-tron',
      'Q8 Sportback e-tron',
      'SQ7',
      'SQ8',
      'Q3 Sportback',
    ],
    hatch: ['A3', 'Q2'],
    sports: ['R8', 'TT'],
  }),
  luxuryCar('Volvo', {
    sedan: ['S60', 'S90', 'ES90', 'S80'],
    suvLarge: [
      'XC40',
      'XC60',
      'XC90',
      'EX30',
      'EX40',
      'EX90',
      'C40 Recharge',
      'XC40 Recharge',
      'XC60 Recharge',
    ],
    hatch: ['V40', 'V40 Cross Country'],
    bus: ['9400', '9600', 'B8R', 'B11R', 'B9R'],
    truck: ['FM 380'],
    lorry: ['FM 420', 'FH 520'],
    tipper: ['FMX 460', 'FMX 500'],
    trailer: ['FH 460 Tractor', 'FM 440 Tractor'],
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
      'Freelander',
      'Freelander 2',
      'Defender 90',
      'Defender 110',
      'Defender 130',
      'Range Rover SV',
    ],
  }),
  luxuryCar('Jaguar', {
    sedan: ['XE', 'XF', 'XJ', 'XJL'],
    suvLarge: ['F-Pace', 'I-Pace', 'E-Pace'],
    sports: ['F-Type', 'XK'],
  }),
  luxuryCar('Lexus', {
    sedan: ['ES', 'LS', 'IS'],
    suvLarge: ['NX', 'RX', 'LX', 'UX'],
    muv: ['LM'],
    sports: ['LC 500h'],
  }),
  luxuryCar('Porsche', {
    sedan: ['Panamera', 'Taycan', 'Panamera 4', 'Taycan Cross Turismo'],
    suvLarge: ['Macan', 'Cayenne', 'Macan Electric', 'Cayenne Coupe', 'Cayenne Electric'],
    sports: ['911', '718 Cayman', '718 Boxster', '911 Carrera', '911 Turbo S', '911 GT3'],
  }),
  luxuryCar('Mini', {
    hatch: [
      'Cooper',
      'Cooper S',
      'Cooper SE',
      'John Cooper Works',
      '3-door',
      '5-door',
      'Convertible',
    ],
    suvMini: ['Countryman', 'Aceman', 'Countryman Electric'],
  }),
  luxuryCar('Lamborghini', {
    suvLarge: ['Urus'],
    sports: ['Huracán', 'Revuelto', 'Aventador', 'Temerario', 'Gallardo'],
  }),
  luxuryCar('Ferrari', {
    sports: [
      'Roma',
      '296',
      'SF90 Stradale',
      'F8 Tributo',
      '812 Superfast',
      'Portofino',
      'Portofino M',
      '12Cilindri',
      'California',
      'GTC4Lusso',
    ],
    suvLarge: ['Purosangue'],
  }),
  luxuryCar('Rolls-Royce', {
    sedan: ['Ghost', 'Phantom', 'Wraith', 'Dawn'],
    suvLarge: ['Cullinan'],
    sports: ['Spectre'],
  }),
  luxuryCar('Bentley', {
    suvLarge: ['Bentayga'],
    sports: ['Continental GT', 'Continental GTC'],
    sedan: ['Flying Spur', 'Mulsanne'],
  }),
  car('Hindustan Motors', {
    sedan: ['Ambassador', 'Contessa', 'Landmaster'],
    jeep: ['Trekker'],
  }),
  car('Ashok Leyland', {
    miniTruck: ['Dost', 'Bada Dost'],
    lightTruck: ['Partner', 'Partner 4 Tyre', 'Partner 6 Tyre', 'Ecomet 1015', 'Boss 1115'],
    pickup: ['Dost Plus', 'Dost Strong', 'Bada Dost i3', 'Bada Dost i4'],
    truck: ['Ecomet 1615', 'Boss 1616', '1616 IL', 'Ecomet Star 1815'],
    lorry: ['2820', '3520', '4220', '4825', 'U-Truck 3518'],
    tipper: ['2825 Tipper', '2832 Tipper', '3532 Tipper', '1920 Tipper'],
    tanker: ['2518 Tanker', '3118 Tanker'],
    trailer: ['4923 Tractor', '5525 Tractor', 'Captain 4019'],
    bus: ['Viking', 'Cheetah', 'Lynx', 'Falcon', 'Sunshine', 'Oyster', 'MiTR', 'Circuit'],
    shareVan: ['Stile'],
  }),
  car('Bajaj', {
    auto: ['RE Auto', 'Maxima', 'RE Compact', 'RE E-TEC 9.0', 'Maxima Z', 'Maxima C', 'GoGo'],
    hatch: ['Qute'],
    cargoAuto: ['Maxima Cargo', 'Maxima XL Cargo', 'RE Cargo'],
  }),
  car('Piaggio', {
    auto: [
      'Ape Auto',
      'Ape City',
      'Ape E-City',
      'Ape DX',
      'Ape Xtra LDX',
      'Ape E-City FX',
      'Ape Auto Plus',
    ],
    cargoAuto: ['Ape Xtra', 'Ape Xtra Dlx', 'Ape E-Xtra FX', 'Porter 700'],
  }),
  car('TVS', {
    auto: ['King', 'King Deluxe', 'King Duramax', 'King EV Max'],
    cargoAuto: ['King Kargo', 'King Kargo HD'],
  }),
  car('Atul', {
    auto: ['Gem', 'Shakti', 'Gem Paxx', 'Elite Plus'],
    eRickshaw: ['Rik', 'Elite'],
    cargoAuto: ['Gem Cargo', 'Shakti Cargo'],
  }),

  car('Reva', {
    hatch: ['Reva i', 'Reva NXR'],
  }),

  car('Mahindra Renault', {
    sedan: ['Logan Edge'],
  }),

  car('Peugeot', {
    sedan: ['309', '206'],
  }),

  car('San Motors', {
    sports: ['Storm'],
  }),

  car('ICML', {
    muv: ['Rhino Rx'],
  }),

  luxuryCar('Maserati', {
    sedan: ['Ghibli', 'Quattroporte'],
    suvLarge: ['Levante', 'Grecale'],
    sports: ['MC20', 'GranTurismo', 'GranCabrio'],
  }),

  luxuryCar('Aston Martin', {
    sports: ['DB11', 'DB12', 'Vantage', 'DBS', 'Vanquish'],
    suvLarge: ['DBX', 'DBX707'],
  }),

  luxuryCar('McLaren', {
    sports: ['GT', '720S', '750S', 'Artura', '765LT'],
  }),

  luxuryCar('Lotus', {
    suvLarge: ['Eletre'],
    sports: ['Emira'],
  }),

  car('Kinetic Green', {
    eRickshaw: ['Safar Smart', 'Safar Shakti', 'Super DX'],
  }),

  car('Lohia', {
    eRickshaw: ['Humsafar', 'Narain', 'Comfort'],
    cargoAuto: ['Narain Cargo'],
  }),

  car('YC Electric', {
    eRickshaw: ['Yatri', 'Yatri Super'],
  }),

  car('Saera', {
    eRickshaw: ['Mayuri', 'Mayuri Grand'],
  }),

  car('Euler', {
    cargoAuto: ['HiLoad EV'],
    miniTruck: ['Storm EV'],
  }),

  car('Omega Seiki', {
    cargoAuto: ['Rage+'],
  }),

  car('Eicher', {
    lightTruck: ['Pro 2049', 'Pro 2059', 'Pro 2095', 'Pro 2110', 'Pro 2114', '10.59', '11.10'],
    truck: ['Pro 3015', 'Pro 3016', 'Pro 3019', 'Pro 6016'],
    lorry: ['Pro 6025', 'Pro 6028', 'Pro 6035', 'Pro 6042', 'Pro 6048'],
    tipper: ['Pro 6028 Tipper', 'Pro 8035XM'],
    tanker: ['Pro 3015 Tanker'],
    trailer: ['Pro 6040 Tractor', 'Pro 6055'],
    bus: ['Skyline', 'Skyline Pro', 'Starline', 'Pro 3008 Bus'],
    tractor: ['242', '333', '380', '485', '548', '557', '551 Prima G3', '650'],
  }),

  car('BharatBenz', {
    lightTruck: ['1015R', '1215R', '1415R'],
    truck: ['1617R', '1917R', '2523R'],
    lorry: ['2823R', '3523R', '4228R', '4828R'],
    tipper: ['2828C', '3528C', '1923C'],
    tanker: ['2823 Tanker'],
    trailer: ['4023T', '5528T', '5532T'],
    bus: ['Glider', '1624 Bus', '917 School Bus'],
  }),

  car('SML Isuzu', {
    lightTruck: ['Sartaj', 'Samrat', 'Supreme'],
    truck: ['Sartaj HG 72'],
    bus: ['Prestige', 'Executive', 'Hiroad', 'S7'],
    tempoTraveller: ['Executive LX'],
  }),

  car('Swaraj', {
    tractor: [
      '717',
      '724 XM',
      '735 FE',
      '735 XT',
      '742 FE',
      '744 FE',
      '744 XT',
      '855 FE',
      '963 FE',
      'Target 625',
      'Target 630',
    ],
  }),

  car('Sonalika', {
    tractor: [
      'DI 30',
      'DI 35',
      'DI 42',
      'DI 47',
      'DI 50',
      'DI 60',
      'DI 745 III',
      'Sikander',
      'Tiger 47',
      'Tiger 60',
      'GT 20',
    ],
  }),

  car('Massey Ferguson', {
    tractor: ['1035 DI', '241 DI', '245 DI', '7250', '9500', '5245', 'Dynatrack', 'Smart'],
  }),

  car('John Deere', {
    tractor: ['5036', '5042', '5045', '5050', '5105', '5205', '5210', '5310', '5405', '3028 EN'],
  }),

  car('New Holland', {
    tractor: ['3037 TX', '3230 TX', '3600-2 TX', '3630 TX', '4710', '5500', '5620', 'Excel 4710'],
  }),

  car('Farmtrac', {
    tractor: ['45', '60', '6055', 'Champion 35', 'Champion 42', 'Atom 26', 'Executive 6060'],
  }),

  car('Powertrac', {
    tractor: ['434', '439', 'Euro 45', 'Euro 50', 'Euro 60', 'ALT 3500', 'Euro G28'],
  }),

  car('Kubota', {
    tractor: ['MU4501', 'MU5502', 'NeoStar A211N', 'L4508', 'B2441'],
  }),

  car('Escorts', {
    tractor: ['Steeltrac', 'Joushila', 'MPT Jawan', 'Digitrac'],
  }),

  car('Indo Farm', {
    tractor: ['3035 DI', '3048 DI', '3055 NV', '4175 DI'],
  }),

  car('Preet', {
    tractor: ['955', '4549', '6049', '3549'],
  }),

  car('ACE', {
    tractor: ['DI 350', 'DI 450', 'DI 550', 'Veer 20'],
    earthmover: ['AF 30 Crane', 'NX 360 Crane', 'AB 4X Backhoe'],
  }),

  car('Captain', {
    tractor: ['200 DI', '250 DI', '280 DI'],
  }),

  car('VST', {
    tractor: ['Shakti MT 270', 'Viraat 4W', '932', '9054 DI'],
  }),

  car('JCB', {
    earthmover: [
      '3DX',
      '3DX Super',
      '3DX Plus',
      '3DX Xtra',
      '4DX',
      '2DX',
      'NXT 140',
      'JS 205',
      'JS 220',
      '432 ZX',
      'Vibromax 116',
      '520 Telehandler',
    ],
  }),

  car('Tata Hitachi', {
    earthmover: ['EX 70', 'EX 110', 'EX 200', 'EX 215', 'Shinrai', 'TH 76 Backhoe'],
  }),

  car('CASE', {
    earthmover: ['770 EX', '851 EX', '1107 EX Roller'],
  }),

  car('Caterpillar', {
    earthmover: ['424', '320', '323', '120 Grader'],
  }),

  car('L&T', {
    earthmover: ['PC 200', 'PC 210'],
  }),

  car('Komatsu', {
    earthmover: ['PC 71', 'PC 130', 'PC 210'],
  }),

  car('Hyundai Construction', {
    earthmover: ['R 210', 'R 140', 'R 30'],
  }),

  car('Escorts Kubota', {
    earthmover: ['Hydra 12', 'Hydra 14', 'Digmax II'],
  }),

  car('Mahindra Construction', {
    earthmover: ['EarthMaster SX', 'EarthMaster VX', 'RoadMaster G9075'],
  }),

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
      'Splendor iSmart',
      'Splendor Pro',
      'HF Deluxe Pro',
      'Passion XPro',
      'Glamour Fi',
      'Xpulse 200',
      'Xpulse 200T',
      'Xtreme 200R',
      'Hunk 150',
      'CD Dawn',
      'Super Splendor 125',
    ],
    sportsBike: ['Xtreme 200S', 'Karizma', 'Karizma ZMR', 'Karizma XMR', 'Karizma R'],
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
      'Destini Prime',
      'Pleasure Plus Xtec',
      'Maestro Edge 125',
    ],
  }),
  bike('Vida', {
    eScooter: ['VX2', 'V2', 'V1', 'VX2 Plus', 'VX2 Go', 'Z'],
  }),
  bike('Honda', {
    premiumBike: [
      'Africa Twin',
      'CBR650R',
      'Gold Wing',
      'CBR1000RR-R Fireblade',
      'CB650R',
      'Transalp XL750',
      'Hornet 750',
      'Rebel 1100',
    ],
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
      'Activa 6G',
      'Activa 5G',
      'Activa 4G',
      'Activa 3G',
      'Activa i',
      'Activa 125 H-Smart',
      'Dio H-Smart',
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
      'Twister',
      'Stunner',
      'CB Shine',
      'Shine',
      'CB Hornet 160R',
      'CBF Stunner',
      'Unicorn Dazzler',
      'Dream Neo',
      'CB Twister',
    ],
    sportsBike: ['CBR 150R', 'CBR 250R'],
    cruiser: ["H'ness CB350", 'CB350', 'CB350RS', 'CB350C', 'CB 500', 'Rebel 300', 'Rebel 500'],
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
      'Scooty Pep',
      'Scooty Zest',
      'Scooty ES',
      'Jupiter Classic',
      'Ntorq 125 Race XP',
      'Wego 110',
    ],
    eScooter: ['iQube', 'Orbiter', 'X'],
    moped: ['XL100', 'XL Super', 'XL Heavy Duty', 'XL100 Comfort', 'Champ'],
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
      'Star City',
      'Star Sport',
      'Apache RTR 150',
      'Apache RTX 300',
      'Victor GLX',
      'Max 4R',
      'Suzuki Shogun',
      'Fiero F2',
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
      'Discover 100',
      'Discover 110',
      'Discover 150',
      'Pulsar 200',
      'Pulsar 200NS',
      'Pulsar AS 150',
      'Pulsar AS 200',
      'Platina 125',
      'KB 125',
      'Wind 125',
      'Byk',
      'CT 100B',
      'Pulsar N160 Twin Disc',
      'Avenger 150',
    ],
    sportsBike: ['Pulsar 220F', 'Pulsar RS200', 'Pulsar F250'],
    cruiser: [
      'Avenger Street 160',
      'Avenger Street 220',
      'Avenger Cruise 220',
      'Avenger 220',
      'Avenger 180',
      'Eliminator',
    ],
    eScooter: ['Chetak'],
    scooter: ['Kristal', 'Chetak Classic', 'Legend', 'Bravo', 'Super', 'Priya', 'Spirit', 'Wave'],
    moped: ['M80', 'Sunny'],
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
      'Machismo',
      'Thunderbird 350',
      'Thunderbird 500',
      'Thunderbird 350X',
      'Thunderbird 500X',
      'Continental GT 535',
      'Bullet 350 Electra',
      'Classic 350 Signals',
      'Classic 350 Chrome',
      'Bullet Trials',
      'Goan Classic',
    ],
    bike: [
      'Himalayan 411',
      'Himalayan 450',
      'Guerrilla 450',
      'Scram 411',
      'Scram 440',
      'Flying Flea C6',
      'Himalayan',
      'Scram 411 Spirit',
      'Himalayan Electric',
    ],
  }),
  bike('Yamaha', {
    premiumBike: ['MT-09', 'YZF-R1', 'YZF-R7', 'MT-07', 'Tracer 9 GT', 'XSR 900'],
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
      'FZ',
      'FZ-S V3',
      'FZ-S V4',
      'FZ-X Hybrid',
      'Fazer FI',
      'SS 125',
      'YBX',
      'RX-Z',
      'RXG',
      'Crux R',
      'Libero G5',
      'MT-15 V2',
    ],
    sportsBike: ['R15 V3', 'R15 V4', 'R15M', 'R15S', 'YZF-R2', 'R3', 'R15', 'R15 V2', 'R15 V1'],
    scooter: [
      'Aerox 155',
      'RayZR 125',
      'Ray',
      'Fascino 125',
      'Alpha',
      'Fascino 110',
      'Ray Z',
      'Ray ZR Street Rally',
      'Cygnus Alpha',
      'Zuma',
    ],
    eScooter: ['Aerox E', 'EC-06'],
  }),
  bike('Suzuki', {
    premiumBike: [
      'V-Strom 800DE',
      'Hayabusa',
      'GSX-8R',
      'GSX-S1000',
      'GSX-S750',
      'Katana',
      'V-Strom 650',
      'GSX-R1000R',
      'Intruder M1800R',
    ],
    scooter: [
      'Access 125',
      'Burgman Street 125',
      'Burgman Street EX',
      'Avenis 125',
      "Let's",
      'Swish',
      'Access',
      'Burgman Street',
      'Avenis',
    ],
    eScooter: ['e-Access'],
    bike: [
      'Gixxer',
      'Gixxer 250',
      'V-Strom SX',
      'Hayate',
      'Slingshot',
      'Zeus',
      'Heat',
      'GS150R',
      'Samurai',
      'Shogun',
      'Gixxer FI',
      'Fiero',
      'Max 100R',
      'Hayate EP',
    ],
    sportsBike: ['Gixxer SF', 'Gixxer SF 250'],
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
      '390 SMC R',
      '390 Adventure X',
      '250 Adventure X',
      'Duke 390 (old)',
    ],
    sportsBike: ['RC 125', 'RC 160', 'RC 200', 'RC 390'],
    premiumBike: [
      '890 Duke R',
      '890 Adventure',
      '1290 Super Duke R',
      '1290 Super Adventure',
      '1390 Super Duke R',
      'RC 8C',
    ],
  }),
  bike('Ather', {
    eScooter: ['Rizta', '450X', '450S', '450 Apex', '450 Plus', '450', '340', 'Rizta Z', 'Rizta S'],
  }),
  bike('Ola', {
    eScooter: ['S1 Pro', 'S1 Air', 'S1 X', 'S1 Z', 'Gig', 'S1', 'S1 Pro Gen 2', 'S1 X+'],
    bike: ['Roadster X', 'Roadster', 'Roadster Pro'],
  }),
  bike('Jawa', {
    cruiser: [
      '42',
      '350',
      '42 Bobber',
      '42 FJ',
      'Perak',
      '42 Bobber Black Mirror',
      '350 Legacy',
      'Jawa 250 (classic)',
    ],
  }),
  bike('Yezdi', {
    cruiser: ['Roadster', 'Roadking', 'Classic', 'Deluxe', 'CL-II', 'Monarch'],
    bike: ['Scrambler', 'Adventure'],
  }),
  bike('BSA', { cruiser: ['Gold Star 650'] }),
  bike('Kawasaki', {
    premiumBike: [
      'Ninja 650',
      'Ninja ZX-10R',
      'Z650',
      'Z900',
      'Versys 650',
      'Vulcan S',
      'Ninja ZX-6R',
      'Ninja 1000SX',
      'Ninja ZX-4R',
      'Ninja H2',
      'Z H2',
      'Z900RS',
      'Versys 1000',
      'Vulcan 900',
    ],
    sportsBike: ['Ninja 300', 'Ninja 400', 'Ninja 500'],
    bike: ['W175', 'KLX 230', 'Z400', 'Z500', 'KLX 110', 'KLX 450R'],
    cruiser: ['Eliminator'],
  }),
  bike('Triumph', {
    premiumBike: [
      'Trident 660',
      'Street Triple',
      'Speed Twin',
      'Tiger 660',
      'Tiger 900',
      'Bonneville',
      'Rocket 3',
      'Speed Triple 1200 RS',
      'Tiger 850 Sport',
      'Tiger 1200',
      'Tiger Sport 660',
      'Scrambler 900',
      'Scrambler 1200',
      'Thruxton RS',
      'Daytona 660',
      'Street Twin',
      'Bonneville T100',
      'Bonneville T120',
      'Bonneville Bobber',
      'Speedmaster',
    ],
    bike: ['Speed 400', 'Scrambler 400 X', 'Speed T4', 'Scrambler 400 XC', 'Thruxton 400'],
  }),
  bike('Harley-Davidson', {
    premiumBike: [
      'Street 750',
      'Street Rod',
      'Iron 883',
      'Forty-Eight',
      'Nightster',
      'Sportster S',
      'Fat Boy',
      'Pan America 1250',
      'Street Glide',
      'Road Glide',
      'Heritage Classic',
      'Low Rider S',
      'Breakout',
      'Fat Bob',
      'Road King',
      'Softail Standard',
      'Iron 1200',
      'Forty-Eight Special',
      'Super Low',
    ],
    cruiser: ['X440', 'X440 T'],
  }),
  bike('BMW', {
    premiumBike: [
      'F 900 GS',
      'R 1300 GS',
      'S 1000 RR',
      'CE 04',
      'M 1000 RR',
      'M 1000 R',
      'S 1000 R',
      'S 1000 XR',
      'R 1250 GS',
      'R 1250 GS Adventure',
      'R 1250 RT',
      'R 18',
      'F 850 GS',
      'F 900 R',
      'F 900 XR',
      'R nineT',
      'K 1600 GTL',
      'C 400 GT',
      'CE 02',
    ],
    bike: ['G 310 R', 'G 310 GS'],
    sportsBike: ['G 310 RR'],
  }),
  bike('Ducati', {
    premiumBike: [
      'Monster',
      'Scrambler',
      'Multistrada V2',
      'Panigale V2',
      'Panigale V4',
      'Panigale V4 S',
      'Streetfighter V4',
      'Streetfighter V2',
      'Diavel V4',
      'XDiavel',
      'Multistrada V4',
      'DesertX',
      'Hypermotard 950',
      'SuperSport 950',
      'Scrambler Icon',
      'Scrambler Full Throttle',
      'Scrambler Nightshift',
      'Monster SP',
    ],
  }),
  bike('Aprilia', {
    scooter: ['SR 125', 'SR 160', 'Storm 125', 'SXR 125', 'SXR 160'],
    sportsBike: ['RS 457'],
    bike: ['Tuono 457'],
    premiumBike: ['RSV4', 'Tuono V4', 'RS 660', 'Tuono 660', 'Tuareg 660'],
  }),
  bike('Vespa', {
    scooter: [
      'VXL 125',
      'SXL 125',
      'VXL 150',
      'SXL 150',
      'Elegante',
      'ZX 125',
      'LX 125',
      'Notte 125',
      'Racing Sixties',
      'S 125',
      'Tech 150',
      'GTS 300',
    ],
  }),
  bike('Husqvarna', {
    bike: ['Svartpilen 250', 'Svartpilen 401', 'Vitpilen 250', 'Vitpilen 401', 'Svartpilen 125'],
    premiumBike: ['Norden 901'],
  }),
  bike('Benelli', {
    bike: ['TNT 300', 'TRK 502', 'Leoncino 500', '502C', 'TRK 251', '302R'],
    cruiser: ['Imperiale 400'],
    premiumBike: ['TRK 702', 'TNT 600i', 'TNT 899'],
  }),
  bike('Keeway', { cruiser: ['K-Light 250V'], bike: ['SR 125'], scooter: ['Vieste 300'] }),
  bike('QJ Motor', { bike: ['SRC 500'], cruiser: ['SRV 300'] }),
  bike('Hyosung', {
    sportsBike: ['GT250R'],
    cruiser: ['Aquila'],
    premiumBike: ['GT650R', 'GV650 Aquila Pro', 'ST7'],
  }),
  bike('LML', {
    scooter: ['NV', 'Select', 'Vespa NV', 'Star', 'Star Euro', 'Trendy'],
    bike: ['Freedom', 'Adreno', 'Beamer'],
  }),
  bike('Kinetic', {
    scooter: ['Kinetic Honda', 'Zing', 'Blaze', 'Nova', 'Flyte', 'Kinetic 4S', 'Kinetic DX'],
    moped: ['Luna', 'Safari', 'Luna Super'],
    bike: ['GF 125', 'Aquila 250'],
  }),
  bike('Ampere', {
    eScooter: ['Magnus', 'Nexus', 'Reo', 'Primus', 'Zeal', 'V48'],
  }),
  bike('Okinawa', {
    eScooter: ['Praise', 'iPraise', 'Ridge', 'Okhi-90', 'Lite', 'R30', 'Dual'],
  }),
  bike('Revolt', {
    bike: ['RV400', 'RV1', 'RV BlazeX', 'RV300'],
  }),
  bike('Ultraviolette', {
    sportsBike: ['F77', 'F77 Mach 2', 'X-47'],
    eScooter: ['Tesseract'],
  }),
  bike('Simple Energy', {
    eScooter: ['One', 'One S', 'Dot One'],
  }),
  bike('River', { eScooter: ['Indie'] }),
  bike('Bounce', {
    eScooter: ['Infinity E1', 'Infinity'],
  }),
  bike('Kinetic Green', { moped: ['E-Luna'], eScooter: ['Zing'] }),
  bike('Pure EV', {
    eScooter: ['ePluto 7G', 'Etrance Neo', 'EPluto 7G Max'],
    bike: ['EcoDryft', 'eTryst 350'],
  }),
  bike('Hero Electric', {
    eScooter: ['Optima', 'Photon', 'Flash', 'NYX', 'Atria', 'Dash', 'Eddy'],
  }),
  bike('BGauss', { eScooter: ['C12', 'RUV 350'] }),
  bike('Lectrix', { eScooter: ['SX25', 'LXS'] }),
  bike('Okaya', { eScooter: ['Faast F2B', 'Freedum'] }),
  bike('Oben', { bike: ['Rorr', 'Rorr EZ'] }),
  bike('Matter', { bike: ['Aera'] }),
  bike('Tork', {
    bike: ['Kratos R', 'Kratos'],
  }),
  bike('Komaki', {
    eScooter: ['Venice', 'SE', 'XGT', 'TN 95', 'DT 3000'],
    cruiser: ['Ranger'],
  }),
  bike('iVoomi', { eScooter: ['JeetX', 'S1'] }),
  bike('Odysse', { bike: ['Evoqis', 'Vader'], eScooter: ['Hawk'] }),
  bike('Yulu', { eScooter: ['Wynn', 'Miracle'] }),
  bike('Mahindra', {
    bike: ['Mojo', 'Centuro', 'Pantero', 'Arro', 'Stallio', 'Mojo UT300'],
    scooter: ['Gusto', 'Rodeo', 'Duro', 'Flyte', 'Kine'],
  }),
  bike('Hero Honda', {
    bike: [
      'Splendor',
      'Splendor Plus',
      'Passion',
      'Passion Plus',
      'CD 100',
      'CD 100 SS',
      'CD Dawn',
      'Sleek',
      'Joy',
      'Street',
      'Ambition',
      'CBZ',
      'CBZ X-treme',
      'Glamour',
      'Hunk',
      'Achiever',
      'Super Splendor',
      'Splendor NXG',
    ],
    sportsBike: ['Karizma', 'Karizma ZMR'],
    scooter: ['Pleasure'],
  }),
  bike('Rajdoot', {
    bike: ['Rajdoot 175', 'Rajdoot 350', 'GTS 175', 'Excel T'],
  }),
  bike('Lambretta', {
    scooter: ['Lambretta', 'Lambretta Li 150', 'Vijai Super'],
  }),
  bike('Indian', {
    premiumBike: [
      'Scout',
      'Scout Bobber',
      'Chief',
      'Chief Bobber',
      'Chieftain',
      'Roadmaster',
      'Springfield',
      'FTR 1200',
      'Pursuit',
    ],
  }),
  bike('Moto Guzzi', {
    premiumBike: ['V85 TT', 'V7 Stone', 'V9 Bobber', 'Stelvio'],
  }),
  bike('MV Agusta', {
    premiumBike: ['Brutale 800', 'F3 800', 'Dragster 800', 'Turismo Veloce', 'Superveloce'],
  }),
  bike('Moto Morini', {
    premiumBike: ['X-Cape 650', 'Seiemmezzo SCR', 'Seiemmezzo STR'],
  }),
  bike('CFMoto', {
    bike: ['300NK', '300SR', '250NK'],
    premiumBike: ['650NK', '650MT', '650GT', '700CL-X', '800MT'],
  }),
  bike('Zontes', {
    bike: ['350R', '350T', '350X', 'GK350'],
  }),
  bike('Brixton', {
    bike: ['Crossfire 500', 'Crossfire 500 X'],
    cruiser: ['Cromwell 1200'],
  }),
  bike('Kabira Mobility', {
    bike: ['KM 3000', 'KM 4000'],
    eScooter: ['Hermes 75'],
  }),
  bike('Raptee', {
    bike: ['T30'],
  }),
  bike('Joy e-bike', {
    eScooter: ['Wolf', 'Gen Next Nanu', 'Glob', 'Mihos'],
    bike: ['Monster', 'Hurricane'],
  }),
  bike('Evtric', {
    eScooter: ['Axis', 'Ride', 'Mighty'],
  }),
  bike('Quantum Energy', {
    eScooter: ['Milan', 'Bziness', 'Plasma'],
  }),
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
  premiumBike: ['premiumBike', 'sportsBike', 'cruiser', 'bike'],
  bus: ['bus', 'tempoTraveller', 'truck'],
  truck: ['truck', 'lightTruck', 'lorry'],
  lorry: ['lorry', 'truck', 'tipper'],
  tipper: ['tipper', 'lorry', 'truck'],
  tanker: ['tanker', 'lorry', 'truck'],
  trailer: ['trailer', 'lorry', 'truck'],
  tractor: ['tractor', 'earthmover'],
  earthmover: ['earthmover', 'tractor'],
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

/**
 * A change head office made to the model list: a model added, moved to another kind of vehicle
 * (bodyKey), or removed (bodyKey null). A rename is the old name removed and the new one added.
 */
export interface VehicleModelEdit {
  make: string;
  model: string;
  category: VehicleCategory;
  /** A catalog body type key ("hatch", "luxury", "tractor"…); null = removed from the list. */
  bodyKey: string | null;
}

/** How a company and model are matched: case and spaces at the ends don't matter. */
export const vehicleModelKey = (make: string, model: string) => `${make.trim().toLowerCase()}|${model.trim().toLowerCase()}`;

/** Make names for a category, A to Z; both categories merged when it isn't known yet. */
export function vehicleMakeNames(category?: VehicleCategory | null, edits: readonly VehicleModelEdit[] = []): string[] {
  if (edits.length) {
    const names = vehicleGuideRows(edits)
      .filter((r) => !category || r.category === category)
      .map((r) => r.make);
    return [...new Set(names)].sort(sortByName);
  }
  const names = VEHICLE_MAKES.filter((m) => !category || m.category === category).map(
    (m) => m.name,
  );
  return [...new Set(names)].sort(sortByName);
}

/** A make's models, A to Z (both categories when it isn't known); empty for a make we don't list. */
export function vehicleModelNames(
  make: string,
  category?: VehicleCategory | null,
  edits: readonly VehicleModelEdit[] = [],
): string[] {
  if (edits.length) {
    const models = vehicleGuideRows(edits)
      .filter((r) => same(r.make, make) && (!category || r.category === category))
      .map((r) => r.model);
    return [...new Set(models)].sort(sortByName);
  }
  const models = VEHICLE_MAKES.filter(
    (m) => same(m.name, make) && (!category || m.category === category),
  ).flatMap((m) => m.models);
  return [...new Set(models)].sort(sortByName);
}

/** The vehicle types to look for for a body type key, best first ("luxury" tries the big cars). */
function keysForBody(bodyKey: string): string[] {
  if (bodyKey === 'luxury') return ['luxury', 'sports', 'suvLarge', 'sedan'];
  return [...(BODY_STYLE_FALLBACKS[bodyKey as BodyStyle] ?? [bodyKey])];
}

/**
 * The vehicle types that suit a listed make and model, best first (photo catalogue keys), or null
 * for a make or model we don't list. Luxury marques' cars try "luxury" before their body style.
 */
export function vehicleTypeKeysFor(make: string, model: string, edits: readonly VehicleModelEdit[] = []): string[] | null {
  const key = vehicleModelKey(make, model);
  const edit = edits.find((e) => vehicleModelKey(e.make, e.model) === key);
  if (edit) return edit.bodyKey ? keysForBody(edit.bodyKey) : null;
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

/** One model in the vehicle size guide: its company, and the body type its size comes from. */
export interface VehicleGuideRow {
  make: string;
  model: string;
  category: VehicleCategory;
  /** The body type it's priced as (a catalog body type key): luxury marques' cars are "luxury". */
  bodyKey: string;
  luxury: boolean;
  /** Head office's change: a model it added, or moved to another kind; none = as listed. */
  change?: 'added' | 'moved';
}

let builtIn: VehicleGuideRow[] | null = null;

/**
 * Every listed model with the body type it's priced as, A to Z by company then model, with head
 * office's changes: models added, moved to another kind, or removed.
 */
export function vehicleGuideRows(edits: readonly VehicleModelEdit[] = []): VehicleGuideRow[] {
  builtIn ??= listedModels();
  if (!edits.length) return builtIn.map((r) => ({ ...r }));
  const byKey = new Map(builtIn.map((r) => [vehicleModelKey(r.make, r.model), { ...r }]));
  for (const e of edits) {
    const key = vehicleModelKey(e.make, e.model);
    const row = byKey.get(key);
    if (!e.bodyKey) {
      byKey.delete(key);
    } else if (row) {
      if (row.bodyKey !== e.bodyKey) {
        row.bodyKey = e.bodyKey;
        row.change = 'moved';
      }
    } else {
      byKey.set(key, { make: e.make.trim(), model: e.model.trim(), category: e.category, bodyKey: e.bodyKey, luxury: false, change: 'added' });
    }
  }
  return [...byKey.values()].sort((a, b) => sortByName(a.make, b.make) || sortByName(a.model, b.model));
}

/** The model as it ships with the app (before head office's changes), or null if it isn't listed. */
export function listedModel(make: string, model: string): VehicleGuideRow | null {
  builtIn ??= listedModels();
  const key = vehicleModelKey(make, model);
  return builtIn.find((r) => vehicleModelKey(r.make, r.model) === key) ?? null;
}

function listedModels(): VehicleGuideRow[] {
  const rows: VehicleGuideRow[] = [];
  for (const m of VEHICLE_MAKES) {
    for (const [body, models] of Object.entries(m.bodies) as [BodyStyle, readonly string[]][]) {
      const bodyKey = m.luxury && PASSENGER_CAR.has(body) && body !== 'sports' ? 'luxury' : body;
      for (const model of models) {
        rows.push({ make: m.name, model, category: m.category, bodyKey, luxury: !!m.luxury });
      }
    }
  }
  return rows.sort((a, b) => sortByName(a.make, b.make) || sortByName(a.model, b.model));
}
