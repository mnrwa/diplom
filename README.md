# Adaptive Logistics Platform

Платформа для управления грузоперевозками с веб-интерфейсом, backend API и AI-сервисом оценки рисков маршрута.

## Стек

- `frontend/` — Next.js 14, React 18, Tailwind CSS
- `backend/` — NestJS 10, Prisma, PostgreSQL
- `ai-service/` — FastAPI, scikit-learn, pandas, Playwright
- инфраструктура — Docker Compose

## Структура проекта

```text
logistics-platform/
├── backend/
├── frontend/
├── ai-service/
├── docker-compose.yml
├── package.json
└── pnpm-workspace.yaml
```

## Запуск через Docker

### 1. Подготовить переменные окружения

При необходимости создайте `.env` в корне проекта на основе `.env.example`.

### 2. Собрать и запустить все сервисы

```bash
docker compose up --build
```

Для запуска в фоне:

```bash
docker compose up -d --build
```

### 3. Остановить проект

```bash
docker compose down
```

Для остановки с удалением томов:

```bash
docker compose down -v
```

## Доступ к сервисам

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:3001`
- Swagger: `http://localhost:3001/api`
- AI service: `http://localhost:8000`
- AI docs: `http://localhost:8000/docs`
- PostgreSQL: `localhost:5432`

## Параметры PostgreSQL

- database: `logistics_db`
- user: `logistics`
- password: `logistics123`

## Docker Compose сервисы

- `postgres` — основная база данных PostgreSQL 16
- `backend` — NestJS API, подключается к `postgres` и `ai-service`
- `ai-service` — FastAPI сервис оценки риска, ETA и новостных сигналов
- `frontend` — Next.js клиент

## Полезные команды

Просмотр логов:

```bash
docker compose logs -f
```

Логи конкретного сервиса:

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f ai-service
docker compose logs -f postgres
```

Пересборка одного сервиса:

```bash
docker compose up --build backend
```

## Примечания

- Основная база проекта хранится в PostgreSQL.
- AI news cache дополнительно хранится в `ai-service/data/news_cache.sqlite3`.
- Backend внутри Docker использует `DATABASE_URL`, указывающий на контейнер `postgres`.
