# 📋 HireBoard

> A premium personal job & internship application tracker with Kanban board, analytics dashboard, and email reminders.

**Live demo:** https://hireboard-mu.vercel.app (the free backend sleeps when idle, so the first request can take up to a minute)

![HireBoard](https://img.shields.io/badge/HireBoard-v1.0.0-6C5CE7?style=for-the-badge)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)
![Node.js](https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?style=flat-square&logo=typescript)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791?style=flat-square&logo=postgresql)

## ✨ Features

- 🔐 **JWT Authentication** — each user sees only their own data
- 📋 **Kanban Board** — drag & drop across Applied → Interview → Offer → Rejected
- 📝 **Full CRUD** — create, edit, delete applications with rich fields
- 📇 **Contact Manager** — store recruiter name, email, phone, LinkedIn per application
- 📜 **Status History** — every stage change tracked with timestamps & notes
- 📊 **Dashboard Analytics** — response rate, rejection rate, monthly bar chart, status pie chart, activity feed
- 📅 **Follow-up Reminders** — set dates and get email reminders automatically (via cron)
- 🔍 **Search & Filter** — filter by status, type, priority; search by company or role

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, React Router 7, Recharts, @hello-pangea/dnd |
| Backend | Node.js 22, Express 5, TypeScript (ES modules), Zod validation |
| Database | PostgreSQL 17, plain SQL migrations |
| Auth | JWT (jsonwebtoken) + bcryptjs, rate-limited login |
| Security | helmet headers, CORS allow-list, one JSON error format |
| Tests & CI | Vitest + Supertest against a real Postgres; GitHub Actions |
| Email | Nodemailer + node-cron |
| Deploy | Vercel (frontend) + Render (backend) + Neon (Postgres) |

## 🚀 Local Setup

### Prerequisites
- Node.js 22+
- Docker Desktop (runs the local Postgres)

### 1. Clone & Install
```bash
git clone https://github.com/arpittts/hireboard.git
cd hireboard
npm run install:all
```

### 2. Start the Database
```bash
docker compose up -d db
```
This starts Postgres 17 (with pgvector) on port **5433**, with a `hireboard` database for development and `hireboard_test` for the tests.

### 3. Configure the Backend
```bash
cp server/.env.example server/.env
# Set JWT_SECRET to any long random string
```

### 4. Create the Tables
```bash
npm run db:migrate
```
Migrations live in `server/migrations/` and run in name order. Each one runs once; the server's deploy runs them automatically.

### 5. Start Development
```bash
# Backend + frontend together
npm run dev
```

Or run them in two terminals with `npm run server` and `npm run client`.

- Frontend: http://localhost:5173
- Backend: http://localhost:5001

### 6. Run the Tests
```bash
npm test
```
The tests use the `hireboard_test` database and cover every API route, including that one user can never read or change another user's data.

## 📁 Project Structure

```
hireboard/
├── server/                      # Express API (TypeScript)
│   ├── migrations/              # 0001_baseline.sql, ... applied in order
│   ├── src/
│   │   ├── index.ts             # Starts the server
│   │   ├── app.ts               # Builds the Express app (also used by tests)
│   │   ├── config.ts            # Reads and checks environment variables
│   │   ├── db/pool.ts           # Postgres pool + transaction helper
│   │   ├── db/migrate.ts        # Migration runner
│   │   ├── middleware/          # auth, errors, rate limits
│   │   ├── routes/              # auth, applications, dashboard
│   │   └── services/            # email reminders
│   └── tests/                   # Vitest + Supertest
├── client/                      # React + Vite SPA
│   └── src/{context,services,components,pages}/
├── docker-compose.yml           # Local Postgres
├── render.yaml                  # Render deploy
└── .github/workflows/ci.yml     # Typecheck, tests, lint, build
```

## 🔧 Environment Variables

### Server (`server/.env`)
```env
DATABASE_URL=postgresql://hireboard:hireboard@localhost:5433/hireboard
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
PORT=5001
CLIENT_URL=http://localhost:5173
AUTH_RATE_LIMIT=10          # failed logins/registrations per IP per 15 minutes

# Optional email reminders
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password
```

The server checks these at startup and stops with a clear message if `DATABASE_URL` or `JWT_SECRET` is missing.

## 🧭 API Errors

Every error has the same shape, so the frontend can show it:

```json
{ "error": { "code": "VALIDATION", "message": "Some fields are invalid.", "fields": { "role": "Role is required." } } }
```

Codes: `VALIDATION` and `BAD_JSON` (400), `UNAUTHORIZED` and `INVALID_CREDENTIALS` (401), `CORS` (403), `NOT_FOUND` (404, also for another user's data), `CONFLICT` (409), `RATE_LIMITED` (429), `INTERNAL` (500).

## 🚢 Deployment

All three pieces run on free plans:

- **Database** → [Neon](https://neon.tech) Postgres. Create a project and copy its connection string. The tables are created by the migrations when the backend deploys.
- **Backend** → [Render](https://render.com) web service from `render.yaml` (New → Blueprint, pick this repo). It builds the TypeScript (`npm ci --include=dev && npm run build`), runs the migrations, then starts the API. Paste the Neon connection string as `DATABASE_URL`; `JWT_SECRET` is generated for you and `CLIENT_URL` is set to the Vercel site. Check it with `GET https://<your-service>.onrender.com/api/health`.
- **Frontend** → [Vercel](https://vercel.com) with root directory `client`. Set `VITE_API_URL` to `https://<your-service>.onrender.com/api` and redeploy.

Notes:
- Render's free service sleeps after 15 minutes without traffic, so the first request after a pause takes about a minute.
- Email reminders run from a daily cron inside the server, so they only fire if the service is awake at 9:00. To use them, add the `SMTP_*` and `EMAIL_FROM` variables in Render's Environment tab.

## 📄 License

MIT © [arpittts](https://github.com/arpittts)
