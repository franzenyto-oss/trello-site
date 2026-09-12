# Mini Trello

Простой full-stack проект на JavaScript: мини-копия Trello с регистрацией, JWT-авторизацией, досками, колонками, карточками, комментариями и drag and drop.

## Стек

- Frontend: React + JavaScript, Create React App
- Backend: Node.js + Express
- Database: PostgreSQL (Neon in production), SQLite for local development/tests
- ORM: Prisma
- Auth: JWT + bcrypt
- Styling: Tailwind CSS
- Docker: Dockerfile + Docker Compose

## Запуск без Docker

Установи зависимости:

```powershell
npm.cmd install
```

Проверь файл `.env`. Для локального запуска достаточно:

```env
DATABASE_URL="file:./dev.db"
SESSION_SECRET="change-this-secret"
```

Собери frontend:

```powershell
npm.cmd run build
```

Запусти приложение:

```powershell
npm.cmd start
```

Открой в браузере:

```text
http://localhost:3000
```

Если порт `3000` занят, можно запустить на другом порту:

```powershell
$env:PORT=3010
npm.cmd start
```

И открыть:

```text
http://localhost:3010
```

## Разработка

Backend:

```powershell
npm.cmd run dev:server
```

Frontend CRA dev server:

```powershell
npm.cmd run dev:client
```

В production-режиме Express отдает собранную папку `build`. Скрипт запуска
выбирает схему Prisma по `DATABASE_URL`: `file:...` использует локальную SQLite,
а PostgreSQL URL использует `prisma db push`.

## Деплой на Render + Neon

В репозитории есть `render.yaml` с настройками web service. Создай Web Service
из этого репозитория в Render и задай следующие переменные окружения:

```env
DATABASE_URL=postgresql://...из Neon...
SESSION_SECRET=длинная-случайная-строка
```

`DATABASE_URL` должен быть Neon connection string; для приложения рекомендуется
pooler URL Neon с параметром `sslmode=require`. Не добавляй реальные значения в
репозиторий. `SESSION_SECRET` можно сгенерировать средствами Render.

Команды Render:

```text
Build Command: npm ci && npm run prisma:generate:postgres && npm run build
Start Command: npm start
```

При старте `npm start` применяет Prisma schema к PostgreSQL через `prisma db
push`, после чего запускает Express на порту из `PORT` (Render задаёт его
автоматически).

## Запуск через Docker

Собери и запусти контейнер:

```bash
docker compose up --build
```

Открой:

```text
http://localhost:3000
```

SQLite база хранится в Docker volume `trello-data` по пути `/data/dev.db`.

Остановить контейнер:

```bash
docker compose down
```

Остановить контейнер и удалить данные базы:

```bash
docker compose down -v
```

## Тесты

Запуск API-тестов:

```powershell
npm.cmd test
```

Тесты используют отдельную временную SQLite-базу и перед запуском генерируют
SQLite Prisma Client. Они проверяют авторизацию, bcrypt-хеширование, JWT, CRUD
досок/колонок/карточек, комментарии и защиту чужих ресурсов.

## Основные файлы

- `src/App.jsx` - React-приложение
- `src/index.css` - Tailwind и кастомные стили
- `server/server.js` - Express API и раздача frontend build
- `prisma/schema.prisma` - Prisma-схема
- `prisma/schema.sqlite.prisma` - локальная SQLite Prisma-схема
- `prisma/setup-db.js` - выбор схемы и инициализация базы
- `prisma/init-db.js` - инициализация SQLite-таблиц
- `tests/api.test.js` - API-тесты
- `Dockerfile` и `docker-compose.yml` - Docker-запуск
