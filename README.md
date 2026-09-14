# Mini Trello

Простой full-stack проект на JavaScript: мини-копия Trello с регистрацией, JWT-авторизацией, досками, колонками, карточками, комментариями и drag and drop.

## Стек

- Frontend: React + JavaScript, Create React App
- Backend: Node.js + Express
- Database: SQLite
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

В production-режиме Express отдает собранную папку `build`.

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

Тесты используют отдельную временную SQLite-базу и проверяют авторизацию, bcrypt-хеширование, JWT, CRUD досок/колонок/карточек, комментарии и защиту чужих ресурсов.

## Основные файлы

- `src/App.jsx` - React-приложение
- `src/index.css` - Tailwind и кастомные стили
- `server/server.js` - Express API и раздача frontend build
- `prisma/schema.prisma` - Prisma-схема
- `prisma/init-db.js` - инициализация SQLite-таблиц
- `tests/api.test.js` - API-тесты
- `Dockerfile` и `docker-compose.yml` - Docker-запуск
