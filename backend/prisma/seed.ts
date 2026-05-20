/**
 * Seed: 20 водителей, 20 машин, 20 складов/точек, 50 маршрутов.
 * Запуск: pnpm run seed
 */
import { PrismaClient, RouteStatus, DriverStatus, VehicleStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://logistics:logistics123@localhost:5432/logistics_db';
const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

// ── Данные ───────────────────────────────────────────────────────────────────

const DRIVER_NAMES = [
  'Александр Петров', 'Дмитрий Иванов', 'Сергей Смирнов', 'Андрей Козлов',
  'Максим Новиков', 'Алексей Морозов', 'Николай Волков', 'Иван Зайцев',
  'Павел Соколов', 'Виктор Лебедев', 'Роман Попов', 'Евгений Соловьёв',
  'Артём Васильев', 'Денис Кузнецов', 'Олег Фёдоров', 'Константин Орлов',
  'Владимир Михайлов', 'Антон Титов', 'Юрий Семёнов', 'Геннадий Чернов',
];

const VEHICLES = [
  { model: 'КАМАЗ-5490', plate: 'А001АА52', maxW: 18000, maxV: 82 },
  { model: 'МАЗ-5440', plate: 'В002ВВ77', maxW: 20000, maxV: 92 },
  { model: 'Volvo FH16', plate: 'С003СС23', maxW: 25000, maxV: 110 },
  { model: 'Scania R500', plate: 'Е004ЕЕ45', maxW: 24000, maxV: 105 },
  { model: 'MAN TGX', plate: 'К005КК63', maxW: 22000, maxV: 98 },
  { model: 'Mercedes Actros', plate: 'М006ММ78', maxW: 23000, maxV: 100 },
  { model: 'DAF XF', plate: 'Н007НН96', maxW: 21000, maxV: 95 },
  { model: 'Iveco Stralis', plate: 'О008ОО16', maxW: 19000, maxV: 88 },
  { model: 'КАМАЗ-65117', plate: 'Р009РР61', maxW: 14500, maxV: 55 },
  { model: 'ГАЗ-3309', plate: 'С010СС54', maxW: 4500, maxV: 16 },
  { model: 'Ford Transit', plate: 'Т011ТТ66', maxW: 1800, maxV: 9 },
  { model: 'Isuzu NQR', plate: 'У012УУ27', maxW: 5200, maxV: 22 },
  { model: 'Hyundai HD78', plate: 'Х013ХХ18', maxW: 4900, maxV: 20 },
  { model: 'КАМАЗ-6520', plate: 'Ч014ЧЧ36', maxW: 20000, maxV: 70 },
  { model: 'Renault Premium', plate: 'Ш015ШШ72', maxW: 19000, maxV: 86 },
  { model: 'Volvo FM', plate: 'Э016ЭЭ34', maxW: 17500, maxV: 78 },
  { model: 'МАЗ-6303', plate: 'Ю017ЮЮ42', maxW: 18000, maxV: 80 },
  { model: 'Scania G410', plate: 'Я018ЯЯ59', maxW: 22000, maxV: 96 },
  { model: 'LADA Largus Фургон', plate: 'А019АА86', maxW: 750, maxV: 3 },
  { model: 'Газель Next', plate: 'В020ВВ74', maxW: 1500, maxV: 7 },
];

const LOCATIONS: Array<{
  name: string; code: string; type: 'WAREHOUSE' | 'PICKUP_POINT';
  city: string; address: string; lat: number; lon: number;
}> = [
  { name: 'Склад Москва-Север', code: 'MSK-N', type: 'WAREHOUSE', city: 'Москва', address: 'Ленинградское ш., 59', lat: 55.8729, lon: 37.4501 },
  { name: 'Склад Москва-Юг', code: 'MSK-S', type: 'WAREHOUSE', city: 'Москва', address: 'Каширское ш., 22', lat: 55.6210, lon: 37.6555 },
  { name: 'Склад Москва-Восток', code: 'MSK-E', type: 'WAREHOUSE', city: 'Москва', address: 'Щёлковское ш., 100', lat: 55.7850, lon: 37.8720 },
  { name: 'Склад Санкт-Петербург', code: 'SPB-1', type: 'WAREHOUSE', city: 'Санкт-Петербург', address: 'Пулковское ш., 50', lat: 59.7905, lon: 30.3225 },
  { name: 'Склад Нижний Новгород', code: 'NNV-1', type: 'WAREHOUSE', city: 'Нижний Новгород', address: 'пр. Молодёжный, 31', lat: 56.2966, lon: 43.9974 },
  { name: 'Склад Казань', code: 'KZN-1', type: 'WAREHOUSE', city: 'Казань', address: 'ул. Складская, 7', lat: 55.8304, lon: 49.0661 },
  { name: 'Склад Екатеринбург', code: 'EKB-1', type: 'WAREHOUSE', city: 'Екатеринбург', address: 'Сибирский тракт, 12', lat: 56.8389, lon: 61.0000 },
  { name: 'Склад Новосибирск', code: 'NSK-1', type: 'WAREHOUSE', city: 'Новосибирск', address: 'ул. Гусинобродская, 45', lat: 54.9705, lon: 82.9935 },
  { name: 'Склад Самара', code: 'SAM-1', type: 'WAREHOUSE', city: 'Самара', address: 'ул. Заводская, 14', lat: 53.1959, lon: 50.1325 },
  { name: 'Склад Ростов-на-Дону', code: 'ROV-1', type: 'WAREHOUSE', city: 'Ростов-на-Дону', address: 'ул. Портовая, 2', lat: 47.2356, lon: 39.7015 },
  { name: 'ПВЗ Тверь', code: 'TVR-1', type: 'PICKUP_POINT', city: 'Тверь', address: 'ул. Советская, 12', lat: 56.8584, lon: 35.9176 },
  { name: 'ПВЗ Ярославль', code: 'YAR-1', type: 'PICKUP_POINT', city: 'Ярославль', address: 'ул. Победы, 38', lat: 57.6261, lon: 39.8845 },
  { name: 'ПВЗ Владимир', code: 'VLD-1', type: 'PICKUP_POINT', city: 'Владимир', address: 'ул. Большая Московская, 5', lat: 56.1290, lon: 40.4069 },
  { name: 'ПВЗ Уфа', code: 'UFA-1', type: 'PICKUP_POINT', city: 'Уфа', address: 'ул. Кирова, 80', lat: 54.7388, lon: 55.9721 },
  { name: 'ПВЗ Пермь', code: 'PRM-1', type: 'PICKUP_POINT', city: 'Пермь', address: 'ул. Ленина, 45', lat: 58.0105, lon: 56.2502 },
  { name: 'ПВЗ Воронеж', code: 'VRN-1', type: 'PICKUP_POINT', city: 'Воронеж', address: 'ул. Плехановская, 10', lat: 51.6720, lon: 39.1843 },
  { name: 'ПВЗ Волгоград', code: 'VGG-1', type: 'PICKUP_POINT', city: 'Волгоград', address: 'пр. Ленина, 91', lat: 48.7080, lon: 44.5133 },
  { name: 'ПВЗ Краснодар', code: 'KRD-1', type: 'PICKUP_POINT', city: 'Краснодар', address: 'ул. Красная, 35', lat: 45.0355, lon: 38.9753 },
  { name: 'ПВЗ Саратов', code: 'SAR-1', type: 'PICKUP_POINT', city: 'Саратов', address: 'ул. Чернышевского, 88', lat: 51.5462, lon: 46.0154 },
  { name: 'ПВЗ Омск', code: 'OMS-1', type: 'PICKUP_POINT', city: 'Омск', address: 'ул. Ленина, 22', lat: 54.9885, lon: 73.3242 },
];

const ROUTE_STATUSES: RouteStatus[] = [
  'COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED',
  'ACTIVE', 'ACTIVE', 'ACTIVE',
  'PLANNED', 'PLANNED', 'PLANNED',
  'CANCELLED',
];

const CARGO_TYPES = [
  'Промышленное оборудование', 'Продукты питания', 'Стройматериалы',
  'Электроника', 'Мебель', 'Запчасти', 'Химическое сырьё',
  'Текстиль', 'Металлопрокат', 'Бумажная продукция',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randFloat(min: number, max: number, digits = 2) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(digits));
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding database...');

  const password = await bcrypt.hash('driver123', 10);

  // ── 1. Admin + dispatcher ──────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: 'admin@velto.ru' },
    update: {},
    create: { email: 'admin@velto.ru', password: await bcrypt.hash('admin123', 10), name: 'Администратор', role: 'ADMIN' },
  });
  const dispatcher = await prisma.user.upsert({
    where: { email: 'dispatch@velto.ru' },
    update: {},
    create: { email: 'dispatch@velto.ru', password: await bcrypt.hash('dispatch123', 10), name: 'Диспетчер Главный', role: 'DISPATCHER' },
  });
  console.log('  ✓ Admin & dispatcher');

  // ── 2. Locations ───────────────────────────────────────────────────────────
  const locationIds: number[] = [];
  for (const loc of LOCATIONS) {
    const l = await prisma.locationPoint.upsert({
      where: { code: loc.code },
      update: {},
      create: loc,
    });
    locationIds.push(l.id);
  }
  console.log(`  ✓ ${locationIds.length} locations`);

  const warehouses = await prisma.locationPoint.findMany({ where: { type: 'WAREHOUSE' } });
  const pickups = await prisma.locationPoint.findMany({ where: { type: 'PICKUP_POINT' } });

  // ── 3. Vehicles ────────────────────────────────────────────────────────────
  const vehicleIds: number[] = [];
  for (const v of VEHICLES) {
    const existing = await prisma.vehicle.findUnique({ where: { plateNumber: v.plate } });
    if (existing) { vehicleIds.push(existing.id); continue; }
    const veh = await prisma.vehicle.create({
      data: {
        plateNumber: v.plate,
        model: v.model,
        maxWeightKg: v.maxW,
        maxVolumeCbm: v.maxV,
        mileageKm: randFloat(15000, 280000, 0),
        lastServiceKm: randFloat(5000, 15000, 0),
        status: 'IDLE' as VehicleStatus,
      },
    });
    vehicleIds.push(veh.id);
  }
  console.log(`  ✓ ${vehicleIds.length} vehicles`);

  // ── 4. Drivers ─────────────────────────────────────────────────────────────
  const driverProfileIds: number[] = [];
  for (let i = 0; i < DRIVER_NAMES.length; i++) {
    const name = DRIVER_NAMES[i];
    const email = `driver${i + 1}@velto.ru`;
    const vehicleId = vehicleIds[i];

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, password, name, role: 'DRIVER', phone: `+7 9${randInt(10, 99)} ${randInt(100, 999)}-${randInt(10, 99)}-${randInt(10, 99)}` },
    });

    const status: DriverStatus = i < 3 ? 'ON_SHIFT' : i < 6 ? 'RESTING' : 'OFFLINE';
    const existing = await prisma.driverProfile.findUnique({ where: { userId: user.id } });
    let profileId: number;
    if (existing) {
      profileId = existing.id;
    } else {
      const profile = await prisma.driverProfile.create({
        data: {
          userId: user.id,
          vehicleId,
          licenseCategory: pick(['B', 'C', 'CE', 'C', 'CE', 'CE']),
          licenseNumber: `${String.fromCharCode(65 + randInt(0, 25))}${String.fromCharCode(65 + randInt(0, 25))} ${randInt(100000, 999999)}`,
          experienceYears: randInt(1, 22),
          rating: randFloat(3.8, 5.0),
          telematicsScore: randFloat(60, 100),
          status,
        },
      });
      profileId = profile.id;
    }
    driverProfileIds.push(profileId);

    // Link vehicle ↔ driver
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { driverName: name, status: status === 'ON_SHIFT' ? 'ON_ROUTE' : 'IDLE' } });

    // Add GPS log for ON_SHIFT drivers
    if (status === 'ON_SHIFT') {
      const wh = pick(warehouses);
      await prisma.gpsLog.create({
        data: {
          vehicleId,
          lat: wh.lat + randFloat(-0.05, 0.05, 4),
          lon: wh.lon + randFloat(-0.05, 0.05, 4),
          speed: randFloat(40, 90),
          timestamp: new Date(Date.now() - randInt(30, 300) * 1000),
        },
      });
    }
  }
  console.log(`  ✓ ${driverProfileIds.length} drivers`);

  // ── 5. Routes (50 штук) ────────────────────────────────────────────────────
  let routeCount = 0;
  for (let i = 0; i < 50; i++) {
    const start = pick(warehouses);
    let end = pick(pickups);
    if (end.id === start.id) end = pickups[(pickups.indexOf(end) + 1) % pickups.length];

    const driverIdx = i % driverProfileIds.length;
    const driverId = driverProfileIds[driverIdx];
    const vehicleId = vehicleIds[driverIdx];
    const status: RouteStatus = pick(ROUTE_STATUSES);
    const distKm = randFloat(200, 2800, 1);
    const etaMin = Math.round((distKm / 70) * 60);
    const cargo = pick(CARGO_TYPES);
    const veh = VEHICLES[driverIdx];
    const createdAt = daysAgo(randInt(0, 60));

    const existing = await prisma.route.findFirst({
      where: { name: `${cargo} ${start.city}–${end.city} #${i + 1}` },
    });
    if (existing) { routeCount++; continue; }

    await prisma.route.create({
      data: {
        name: `${cargo} ${start.city}–${end.city} #${i + 1}`,
        status,
        startLat: start.lat,
        startLon: start.lon,
        endLat: end.lat,
        endLon: end.lon,
        startPointId: start.id,
        endPointId: end.id,
        vehicleId,
        driverId,
        dispatcherId: dispatcher.id,
        distance: distKm,
        estimatedTime: etaMin,
        riskScore: randFloat(0.05, 0.75),
        fuelCostRub: Math.round(distKm * randFloat(18, 35)),
        cargoWeightKg: randFloat(500, veh.maxW * 0.9, 0),
        cargoVolumeCbm: randFloat(1, veh.maxV * 0.8, 1),
        trackingToken: randomUUID(),
        riskFactors: { weather: randFloat(0.1, 0.4), news: randFloat(0.05, 0.35), routing: { source: 'osrm' } },
        createdAt,
        updatedAt: createdAt,
      },
    });
    routeCount++;
  }
  console.log(`  ✓ ${routeCount} routes`);

  console.log('\n✅ Seed completed!');
  console.log('   Admin:      admin@velto.ru / admin123');
  console.log('   Dispatcher: dispatch@velto.ru / dispatch123');
  console.log('   Drivers:    driver1@velto.ru … driver20@velto.ru / driver123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
