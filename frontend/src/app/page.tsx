"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Boxes,
  Briefcase,
  Building2,
  Clock3,
  MapPinned,
  Plus,
  Route,
  Search,
  ShieldCheck,
  Truck,
  Warehouse,
} from "lucide-react";
import { getStoredUser } from "@/lib/session";

const trackingSamples = [
  {
    number: "DL-240518",
    status: "В пути",
    statusTone: "amber" as const,
    route: "Новосибирск → Екатеринбург → Москва",
    eta: "6 апреля, 13:30",
    service: "Сборный груз",
    cargo: "4 места, 186 кг",
    lastEvent: "Перегружен на магистральный рейс в Екатеринбурге",
    progress: 72,
  },
  {
    number: "CDEK-884301",
    status: "Готов к выдаче",
    statusTone: "emerald" as const,
    route: "Москва → Иркутск",
    eta: "Сегодня до 20:00",
    service: "Экспресс до ПВЗ",
    cargo: "1 коробка, 7 кг",
    lastEvent: "Доставлен в ПВЗ и ожидает получателя",
    progress: 100,
  },
  {
    number: "ALP-100245",
    status: "Оформляется",
    statusTone: "sky" as const,
    route: "Красноярск → Омск",
    eta: "7 апреля, 11:00",
    service: "Доставка до двери",
    cargo: "2 палеты, 412 кг",
    lastEvent: "Подтверждены данные отправителя и время забора",
    progress: 18,
  },
];

const heroStats = [
  { value: "Трекинг 24/7", label: "публичный статус по номеру заказа или накладной" },
  { value: "Склад → ПВЗ", label: "создание отправки без ручной работы с координатами" },
  { value: "ETA + события", label: "маршрут, дорожная ситуация и сигналы по пути" },
];

const serviceCards = [
  {
    icon: Truck,
    title: "Сборные грузы и LTL",
    text: "Маршруты между терминалами, складами и ПВЗ с учётом дорог, ETA и риска по участкам.",
  },
  {
    icon: Warehouse,
    title: "Складская логистика",
    text: "Отдельный контур для сети складов и пунктов выдачи: приём, отгрузка и контроль узлов маршрута.",
  },
  {
    icon: Briefcase,
    title: "Для бизнеса и маркетплейсов",
    text: "Корпоративные отправки, поставки на маркетплейсы, работа с регулярными рейсами и окнами доставки.",
  },
  {
    icon: Building2,
    title: "Личный кабинет и диспетчерская",
    text: "Клиент видит трекинг и статус заказа, оператор управляет водителями, точками и планированием.",
  },
];

const businessFlow = [
  {
    step: "01",
    title: "Найдите заказ за секунду",
    text: "На главной странице пользователь вводит номер отправления и сразу получает статус, ETA и последнее событие.",
  },
  {
    step: "02",
    title: "Создайте новую отправку",
    text: "Оформление начинается с простых полей: откуда, куда, тип груза и вес. Дальше заявка уходит в рабочий контур.",
  },
  {
    step: "03",
    title: "Следите за движением",
    text: "Маршрут, транспорт, новости по пути и отклонения собираются в единую ленту для диспетчера и водителя.",
  },
];

const routeDirections = [
  {
    title: "Межтерминальная доставка",
    text: "Классический сценарий федеральных перевозчиков: терминал → магистраль → терминал → получатель.",
    badge: "LTL / FTL",
  },
  {
    title: "Склад → ПВЗ",
    text: "Подходит для e-commerce, last mile и маркетплейсов, когда важны быстрые окна доставки и прозрачный статус.",
    badge: "e-commerce",
  },
  {
    title: "Забор у отправителя",
    text: "Создание заявки с выездом машины к клиенту, последующим трекингом и информированием по этапам.",
    badge: "door-to-door",
  },
];

export default function LandingPage() {
  const router = useRouter();
  const [cabinetHref, setCabinetHref] = useState("/login");
  const [cabinetLabel, setCabinetLabel] = useState("Войти в личный кабинет");
  const [createHref, setCreateHref] = useState("/login?mode=register");
  const [trackDraft, setTrackDraft] = useState(trackingSamples[0].number);
  const [submittedTrack, setSubmittedTrack] = useState(trackingSamples[0].number);
  const [newOrderDraft, setNewOrderDraft] = useState({
    from: "Новосибирск",
    to: "Москва",
    cargoType: "Сборный груз",
    weight: "180",
  });

  useEffect(() => {
    const user = getStoredUser();
    if (!user) return;

    if (user.role === "DRIVER") {
      setCabinetHref("/driver");
      setCabinetLabel("Открыть кабинет водителя");
      setCreateHref("/driver");
      return;
    }

    setCabinetHref("/dashboard");
    setCabinetLabel("Открыть рабочий кабинет");
    setCreateHref("/dashboard");
  }, []);

  const trackingResult = useMemo(
    () =>
      trackingSamples.find(
        (item) => item.number.toLowerCase() === submittedTrack.trim().toLowerCase(),
      ) || null,
    [submittedTrack],
  );

  const createOrderSummary = `${newOrderDraft.from} → ${newOrderDraft.to} · ${newOrderDraft.cargoType} · ${newOrderDraft.weight} кг`;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-6">
      <header className="liquid-panel rounded-[34px] px-6 py-5 md:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-3xl bg-slate-900 text-white shadow-lg">
              <Truck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-slate-400">
                Adaptive Logistics Platform
              </p>
              <h1 className="mt-2 font-[Georgia] text-2xl text-slate-900 md:text-3xl">
                Логистика, трекинг и оформление отправок в одном окне
              </h1>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <a href="#tracking" className="rounded-full px-4 py-2 transition hover:bg-slate-100">
              Отследить заказ
            </a>
            <a href="#services" className="rounded-full px-4 py-2 transition hover:bg-slate-100">
              Услуги
            </a>
            <a href="#business" className="rounded-full px-4 py-2 transition hover:bg-slate-100">
              Для бизнеса
            </a>
            <Link
              href={cabinetHref}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 font-semibold text-white"
            >
              {cabinetLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      </header>

      <section className="mt-5 grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <article className="liquid-panel liquid-panel-hero rounded-[40px] p-7 md:p-10">
          <div className="liquid-chip inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs uppercase tracking-[0.28em] text-slate-500">
            <ShieldCheck className="h-4 w-4" />
            Логистический интерфейс в стиле коммерческих перевозчиков
          </div>

          <h2 className="mt-7 max-w-4xl font-[Georgia] text-4xl leading-[1.02] text-slate-900 md:text-6xl">
            Введите номер заказа, проверьте статус или сразу оформите новую отправку.
          </h2>

          <p className="mt-6 max-w-3xl text-base leading-8 text-slate-600 md:text-lg">
            Главная страница перестроена под привычный для транспортных компаний
            сценарий: сначала трекинг, затем быстрое создание заказа, а ниже услуги,
            направления, деловой блок и инфраструктура сети.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={createHref}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-4 text-sm font-semibold text-white shadow-lg shadow-slate-300 transition hover:bg-slate-800"
            >
              Создать новый заказ
              <Plus className="h-4 w-4" />
            </Link>
            <a
              href="#tracking"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-4 text-sm font-medium text-slate-700 transition hover:border-slate-300"
            >
              Отследить отправление
              <Search className="h-4 w-4" />
            </a>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {heroStats.map((item) => (
              <StatCard key={item.value} value={item.value} label={item.label} />
            ))}
          </div>
        </article>

        <div className="grid gap-5">
          <article
            id="tracking"
            className="liquid-panel rounded-[40px] p-7 md:p-8"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.32em] text-slate-400">
                  Трекинг заказа
                </p>
                <h3 className="mt-3 font-[Georgia] text-3xl text-slate-900">
                  Проверка статуса по номеру
                </h3>
              </div>
              <span className="liquid-chip rounded-full px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                Demo tracking
              </span>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <input
                value={trackDraft}
                onChange={(event) => setTrackDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setSubmittedTrack(trackDraft);
                  }
                }}
                placeholder="Номер заказа или накладной"
                className="h-14 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-slate-900 outline-none transition focus:border-emerald-300 focus:bg-white"
              />
              <button
                type="button"
                onClick={() => setSubmittedTrack(trackDraft)}
                className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                <Search className="h-4 w-4" />
                Проверить
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {trackingSamples.map((item) => (
                <button
                  key={item.number}
                  type="button"
                  onClick={() => {
                    setTrackDraft(item.number);
                    setSubmittedTrack(item.number);
                  }}
                  className="liquid-chip rounded-full px-3 py-2 text-xs font-medium text-slate-600 transition"
                >
                  {item.number}
                </button>
              ))}
            </div>

            {trackingResult ? (
              <div className="liquid-card mt-6 rounded-[28px] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusTone(trackingResult.statusTone)}`}>
                      {trackingResult.status}
                    </span>
                    <h4 className="mt-3 text-xl font-semibold text-slate-900">
                      Заказ {trackingResult.number}
                    </h4>
                    <p className="mt-1 text-sm text-slate-500">{trackingResult.route}</p>
                  </div>
                  <div className="text-right text-sm text-slate-500">
                    <div>ETA</div>
                    <strong className="mt-1 block text-base text-slate-900">
                      {trackingResult.eta}
                    </strong>
                  </div>
                </div>

                <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${trackingResult.progress}%` }}
                  />
                </div>

                <div className="mt-5 grid gap-3 text-sm text-slate-600 sm:grid-cols-3">
                  <InfoCell label="Услуга" value={trackingResult.service} />
                  <InfoCell label="Груз" value={trackingResult.cargo} />
                  <InfoCell label="Последнее событие" value={trackingResult.lastEvent} />
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-[28px] border border-amber-200 bg-amber-50/80 p-5 text-sm leading-7 text-amber-900">
                Номер не найден в демонстрационных данных. Для проверки интерфейса
                используйте один из примеров выше.
              </div>
            )}
          </article>

          <article className="liquid-panel-dark rounded-[40px] p-7 text-white md:p-8">
            <p className="text-xs uppercase tracking-[0.32em] text-slate-400">
              Новая отправка
            </p>
            <h3 className="mt-3 font-[Georgia] text-3xl">
              Создать заказ за минуту
            </h3>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <LandingInput
                label="Откуда"
                value={newOrderDraft.from}
                onChange={(value) => setNewOrderDraft((current) => ({ ...current, from: value }))}
              />
              <LandingInput
                label="Куда"
                value={newOrderDraft.to}
                onChange={(value) => setNewOrderDraft((current) => ({ ...current, to: value }))}
              />
              <LandingInput
                label="Тип груза"
                value={newOrderDraft.cargoType}
                onChange={(value) => setNewOrderDraft((current) => ({ ...current, cargoType: value }))}
              />
              <LandingInput
                label="Вес, кг"
                value={newOrderDraft.weight}
                onChange={(value) => setNewOrderDraft((current) => ({ ...current, weight: value }))}
              />
            </div>

            <div className="liquid-card-dark mt-5 rounded-[26px] px-4 py-4">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-400">
                Черновик отправки
              </div>
              <div className="mt-2 text-sm leading-7 text-slate-200">{createOrderSummary}</div>
            </div>

            <button
              type="button"
              onClick={() => router.push(createHref)}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-4 text-sm font-semibold text-slate-900"
            >
              Перейти к оформлению
              <ArrowRight className="h-4 w-4" />
            </button>
          </article>
        </div>
      </section>

      <section
        id="services"
        className="liquid-panel mt-5 rounded-[40px] p-7 md:p-10"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-slate-400">
              Популярные сценарии
            </p>
            <h3 className="mt-3 font-[Georgia] text-3xl text-slate-900 md:text-4xl">
              Интерфейс собран как стартовая страница транспортной компании
            </h3>
          </div>
          <div className="liquid-chip rounded-full px-4 py-2 text-sm text-slate-500">
            Трекинг + оформление + деловой контур
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {serviceCards.map(({ icon: Icon, title, text }) => (
            <article
              key={title}
              className="liquid-card rounded-[30px] p-6"
            >
              <div className="mb-5 inline-flex rounded-2xl bg-slate-900 p-3 text-white">
                <Icon className="h-5 w-5" />
              </div>
              <h4 className="text-lg font-semibold text-slate-900">{title}</h4>
              <p className="mt-3 text-sm leading-7 text-slate-600">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[1.02fr_0.98fr]">
        <article
          id="business"
          className="liquid-panel rounded-[40px] p-7 md:p-10"
        >
          <p className="text-xs uppercase tracking-[0.32em] text-slate-400">
            Для бизнеса
          </p>
          <h3 className="mt-3 font-[Georgia] text-3xl text-slate-900 md:text-4xl">
            От поиска заказа до диспетчерской аналитики
          </h3>

          <div className="mt-8 space-y-4">
            {businessFlow.map((item) => (
              <div
                key={item.step}
                className="liquid-card rounded-[28px] p-5"
              >
                <div className="flex items-start gap-4">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-900 text-sm font-semibold text-white">
                    {item.step}
                  </div>
                  <div>
                    <h4 className="text-lg font-semibold text-slate-900">{item.title}</h4>
                    <p className="mt-2 text-sm leading-7 text-slate-600">{item.text}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="liquid-panel-dark rounded-[40px] p-7 text-white md:p-10">
          <p className="text-xs uppercase tracking-[0.32em] text-slate-400">
            Сценарии доставки
          </p>
          <h3 className="mt-3 font-[Georgia] text-3xl md:text-4xl">
            Паттерны, которые ожидает клиент логистического сервиса
          </h3>

          <div className="mt-8 grid gap-4">
            {routeDirections.map((item) => (
              <div
                key={item.title}
                className="liquid-card-dark rounded-[28px] p-5"
              >
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-lg font-semibold">{item.title}</h4>
                  <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-300">
                    {item.badge}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-300">{item.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <DarkMetric icon={<MapPinned className="h-4 w-4" />} text="Карта точек и маршрутов" />
            <DarkMetric icon={<Clock3 className="h-4 w-4" />} text="ETA и статусные этапы" />
            <DarkMetric icon={<Route className="h-4 w-4" />} text="Маршрутизация по дорогам" />
          </div>
        </article>
      </section>

      <section className="liquid-panel mt-5 rounded-[40px] p-7 md:p-10">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-slate-400">
              Быстрый обзор
            </p>
            <h3 className="mt-3 font-[Georgia] text-3xl text-slate-900 md:text-4xl">
              На стартовой видно и клиентский, и операционный слой
            </h3>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <QuickCard
            icon={<Search className="h-5 w-5" />}
            title="Трекинг по номеру"
            text="Главный CTA на первом экране, как у публичных сайтов доставки."
          />
          <QuickCard
            icon={<Boxes className="h-5 w-5" />}
            title="Оформление новой заявки"
            text="Отдельный сценарий рядом с трекингом, без перегруза техническими полями."
          />
          <QuickCard
            icon={<MapPinned className="h-5 w-5" />}
            title="Сеть точек"
            text="Склады, ПВЗ, магистральные этапы и last mile собраны в одну модель."
          />
          <QuickCard
            icon={<Warehouse className="h-5 w-5" />}
            title="Рабочий контур"
            text="После входа доступен кабинет оператора, водителя и управление рейсами."
          />
        </div>
      </section>
    </main>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="liquid-card rounded-[28px] px-5 py-6">
      <strong className="block text-2xl text-slate-900">{value}</strong>
      <span className="mt-2 block text-sm leading-6 text-slate-500">{label}</span>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="liquid-card rounded-[20px] px-4 py-4">
      <span className="block text-[11px] uppercase tracking-[0.22em] text-slate-400">
        {label}
      </span>
      <strong className="mt-2 block text-sm leading-6 text-slate-900">{value}</strong>
    </div>
  );
}

function LandingInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-2xl border border-white/10 bg-white/8 px-4 text-white outline-none transition focus:border-emerald-300/60 focus:bg-white/10"
      />
    </label>
  );
}

function QuickCard({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <article className="liquid-card rounded-[30px] p-6">
      <div className="mb-5 inline-flex rounded-2xl bg-slate-900 p-3 text-white">
        {icon}
      </div>
      <h4 className="text-lg font-semibold text-slate-900">{title}</h4>
      <p className="mt-3 text-sm leading-7 text-slate-600">{text}</p>
    </article>
  );
}

function DarkMetric({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="liquid-card-dark flex items-center gap-3 rounded-[22px] px-4 py-4 text-sm text-slate-200">
      <div className="rounded-2xl bg-white/10 p-2.5 text-white">{icon}</div>
      <span>{text}</span>
    </div>
  );
}

function statusTone(tone: "emerald" | "amber" | "sky") {
  if (tone === "emerald") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (tone === "sky") {
    return "bg-sky-100 text-sky-700";
  }
  return "bg-amber-100 text-amber-700";
}
