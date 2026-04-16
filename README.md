# Adaptive Logistics Platform

Дипломный проект: **адаптивная система оптимизации грузоперевозок с ИИ**.

## Структура

```text
logistics-platform/
├── backend/      # NestJS API + Prisma
├── frontend/     # Next.js интерфейс
├── ai-service/   # FastAPI сервис для risk/weather/news
├── scripts/      # локальные dev-скрипты
└── package.json  # root pnpm workspace
```

## Локальный запуск без Docker

### 1. Установить зависимости

```bash
pnpm install
```

### 2. Запустить весь проект

```bash
pnpm run dev
```

Что делает root `dev`:

- поднимает локальный PostgreSQL в `.local/postgres-data`
- создаёт базу `logistics_db`
- запускает `ai-service` в `.local/ai-venv`
- запускает `backend` в watch mode
- запускает `frontend` в Next.js dev mode

## Доступ

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:3001`
- Swagger: `http://localhost:3001/api`
- AI service: `http://localhost:8000`
- AI docs: `http://localhost:8000/docs`

## AI news collector

- AI-сервис теперь поднимает фоновый news collector при старте и складывает сигналы в `ai-service/data/news_cache.sqlite3`
- поддерживаются источники `local_export`, `rss`, `html` и `browser_html`
- в `news_sources.json` можно включать `route_search_rss`: такой источник не хранит фиксированный список сайтов, а сам ищет свежие региональные новости по населённым пунктам вдоль маршрута
- для маршрута `A -> B -> промежуточные точки` AI:
  - берёт известные города из маршрута
  - определяет дополнительные населённые пункты по координатам через reverse geocoding
  - делает интернет-поиск свежих новостей по этим локациям
  - забирает публикации региональных сайтов и учитывает их в `news-risks/route`
- маршрутизатор AI оценивает релевантность новостей маршруту `A -> B -> промежуточные точки` и возвращает `total_risk` + `risks`
- служебные ручки:
  - `GET http://localhost:8000/news-collector/status`
  - `POST http://localhost:8000/news-collector/refresh`
  - `GET http://localhost:8000/news-feed`
  - `POST http://localhost:8000/news-risks/route`
- переменные route discovery:
  - `NEWS_ROUTE_DISCOVERY_FRESH_SECONDS`
  - `NEWS_ROUTE_LOCALITIES_LIMIT`
  - `NEWS_ROUTE_GEOCODE_POINTS`
- для динамических сайтов со скроллом после `pip install -r ai-service/requirements.txt` один раз выполните:
  - `python -m playwright install chromium`

## Полезные команды

```bash
pnpm run dev:db
pnpm run dev:db:status
pnpm run dev:db:stop
pnpm run dev:ai
```

## Требования

- `pnpm` 10+
- Python 3.14+ или совместимый
- локальные PostgreSQL binaries:
  - либо в `PATH`
  - либо в `D:\postgres\bin`
  - либо в `C:\Program Files\PostgreSQL\16\bin`

## Примечания

- `backend/.env` и `frontend/.env.local` уже настроены под локальный запуск.
- Для полного 2GIS-режима с кликабельными зданиями и POI добавьте `NEXT_PUBLIC_2GIS_KEY` в `frontend/.env.local`.
- Для AI используются актуальные Python-пакеты, совместимые с локальным Python 3.14.
- Маршруты теперь строятся по дорожной сети через OSRM и при создании/пересчёте учитывают длину пути, ETA, дорожные события, news-risk и погодный риск.
- Docker больше не нужен для стандартной разработки проекта.
