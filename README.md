# 📋 HireBoard

> A premium personal job & internship application tracker with Kanban board, analytics dashboard, and email reminders.

**Live demo:** https://hireboard-mu.vercel.app. Click **Try the demo** for a ready-made account with sample data, no sign-up. The free backend sleeps when idle, so the first request can take up to a minute.

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
- 📅 **Follow-up Reminders** — opt-in emails on follow-up dates, sent by a daily GitHub Actions job
- 🤖 **Paste a job description** — AI fills company, role, location, pay, deadline and requirements; you check before saving
- 🔍 **Search & Filter** — filter by status, type, priority; search by company or role
- ✨ **One-click demo** — a fresh account with 12 synthetic applications, deleted after 24 hours
- ⌨️ **Keyboard friendly** — every Kanban card has a status menu as well as drag and drop
- 🔒 **Your data, your call** — export everything as JSON or delete your account in Settings

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, React Router 7, TanStack Query, Recharts, @hello-pangea/dnd |
| Backend | Node.js 22, Express 5, TypeScript (ES modules), Zod validation |
| Database | PostgreSQL 17, plain SQL migrations |
| Auth | JWT (jsonwebtoken) + bcryptjs, rate-limited login |
| Security | helmet headers, CORS allow-list, one JSON error format |
| Tests & CI | Vitest + Supertest against a real Postgres; GitHub Actions |
| AI | Vercel AI SDK + Gemini (free tier), Zod-validated structured output |
| Email | Nodemailer, triggered daily by GitHub Actions |
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
│   ├── prompts/                 # versioned prompt files
│   ├── scripts/eval-jd.ts       # JD extraction eval
│   ├── src/
│   │   ├── index.ts             # Starts the server
│   │   ├── app.ts               # Builds the Express app (also used by tests)
│   │   ├── config.ts            # Reads and checks environment variables
│   │   ├── db/pool.ts           # Postgres pool + transaction helper
│   │   ├── db/migrate.ts        # Migration runner
│   │   ├── middleware/          # auth, errors, rate limits
│   │   ├── ai/                  # provider, runStructured, JD extraction
│   │   ├── routes/              # auth, applications, dashboard, ai, settings, internal
│   │   └── services/            # demo data, email reminders
│   └── tests/                   # Vitest + Supertest
├── client/                      # React + Vite SPA
│   └── src/{context,services,components,pages}/
├── evals/                       # datasets, recorded model replies, reports
├── docker-compose.yml           # Local Postgres
├── render.yaml                  # Render deploy
├── .github/workflows/ci.yml     # Typecheck, tests, lint, build
└── .github/workflows/cron.yml   # Daily reminders + demo cleanup
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
CRON_SECRET=any-long-random-string   # enables /api/internal/* for the daily job

# Optional email reminders
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password
```

The server checks these at startup and stops with a clear message if `DATABASE_URL` or `JWT_SECRET` is missing.

## 🤖 AI Layer

Every AI feature goes through one function, `runStructured()` in `server/src/ai/run.ts`. It:

1. **Answers repeated inputs from a cache** (`llm_cache`, keyed by a hash of feature + model + prompt version + input), for free and instantly.
2. **Enforces daily quotas:** 40 requests per user (15 for demo accounts) and `AI_GLOBAL_DAILY_LIMIT` across everyone. Cached answers don't count, and limits reset at midnight India time.
3. **Calls the model with a Zod schema.** If the reply doesn't fit, it retries once and tells the model what was wrong.
4. **Logs every call** to `llm_calls` (tokens, latency, status), which feeds the usage card in Settings.

Prompts are versioned files in `server/prompts/` (for example `jd_extract.v1.md`); the version is saved with every result.

**Job description capture** (`server/src/ai/jdExtract.ts`): the model fills the schema, then code checks what models get wrong:
- Links not present in the posting are dropped.
- Impossible or very old deadlines are dropped.
- Salary ranges with min above max are cleared.
- A company name the posting never mentions is flagged.

The posting is passed as delimited data, the prompt tells the model to ignore instructions inside it, and extraction calls have no tools.

### Evaluation

`evals/datasets/jd_extraction.json` has 40 synthetic postings with hand-written labels: Indian LPA and monthly stipends, USD/GBP/EUR/CHF/SGD pay, remote, hybrid and on-site jobs, agency postings that hide the employer, and 5 postings with prompt-injection text.

```bash
cd server
npm run eval:jd          # replays recorded model replies: offline, free, repeatable
npm run eval:jd:record   # calls Gemini and saves new recordings (needs GEMINI_API_KEY)
```

The latest results are in `evals/reports/jd_extract.md`. The target is ≥ 90% field accuracy, with no injected instruction followed.

## 🧭 API Errors

Every error has the same shape, so the frontend can show it:

```json
{ "error": { "code": "VALIDATION", "message": "Some fields are invalid.", "fields": { "role": "Role is required." } } }
```

Codes: `VALIDATION` and `BAD_JSON` (400), `UNAUTHORIZED` and `INVALID_CREDENTIALS` (401), `CORS` (403), `NOT_FOUND` (404, also for another user's data), `CONFLICT` (409), `RATE_LIMITED` and `AI_QUOTA` (429), `INTERNAL` (500), and for AI calls `AI_ERROR`/`AI_BAD_OUTPUT` (502), `AI_DISABLED`/`AI_BUSY` (503), `AI_TIMEOUT` (504).

## 🚢 Deployment

All three pieces run on free plans:

- **Database** → [Neon](https://neon.tech) Postgres. Create a project and copy its connection string. The tables are created by the migrations when the backend deploys.
- **Backend** → [Render](https://render.com) web service from `render.yaml` (New → Blueprint, pick this repo). It builds the TypeScript (`npm ci --include=dev && npm run build`), runs the migrations, then starts the API. Paste the Neon connection string as `DATABASE_URL`; `JWT_SECRET` is generated for you and `CLIENT_URL` is set to the Vercel site. Check it with `GET https://<your-service>.onrender.com/api/health`.
- **Frontend** → [Vercel](https://vercel.com) with root directory `client`. Set `VITE_API_URL` to `https://<your-service>.onrender.com/api` and redeploy.

### Daily jobs (reminders and demo cleanup)

The free Render server sleeps, so it can't run its own timer. Instead, `.github/workflows/cron.yml` runs every day at 09:00 India time and calls two protected endpoints:

- `POST /api/internal/reminders` emails users who turned reminders on in Settings, for follow-up dates in the last 3 days (at most 5 per user; demo accounts never get email).
- `POST /api/internal/cleanup` deletes demo accounts older than 24 hours.

Setup:
1. Render generates `CRON_SECRET` (from `render.yaml`). Copy it from the service's **Environment** tab.
2. In GitHub → **Settings → Secrets and variables → Actions**, add `CRON_SECRET` (that value) and `API_URL` (`https://<your-service>.onrender.com`).
3. For email, add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM` in Render (a Gmail app password works).
4. Run it once by hand: GitHub → **Actions → Daily jobs → Run workflow**.

Note: Render's free service sleeps after 15 minutes without traffic, so the first request after a pause takes about a minute. The app shows a "waking the free server" banner meanwhile.

## 📄 License

MIT © [arpittts](https://github.com/arpittts)
