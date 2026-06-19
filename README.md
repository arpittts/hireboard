# 📋 HireBoard

> A premium personal job & internship application tracker with Kanban board, analytics dashboard, and email reminders.

![HireBoard](https://img.shields.io/badge/HireBoard-v1.0.0-6C5CE7?style=for-the-badge)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![Node.js](https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=node.js)
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
| Frontend | React 18, Vite, React Router, Recharts, @hello-pangea/dnd |
| Backend | Node.js, Express.js |
| Database | PostgreSQL 17 |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Email | Nodemailer + node-cron |
| Deploy | Vercel (frontend) + Railway (backend + DB) |

## 🚀 Local Setup

### Prerequisites
- Node.js 18+
- PostgreSQL 14+

### 1. Clone & Install
```bash
git clone https://github.com/arpittts/hireboard.git
cd hireboard
npm run install:all
```

### 2. Configure Backend
```bash
cp server/.env.example server/.env
# Edit server/.env with your DATABASE_URL and JWT_SECRET
```

### 3. Init Database
```bash
# Create the database
createdb hireboard
# Run schema
npm run db:init
```

### 4. Start Development
```bash
# Terminal 1 - Backend
npm run server

# Terminal 2 - Frontend
npm run client
```

- Frontend: http://localhost:5173
- Backend: http://localhost:5001

## 📁 Project Structure

```
hireboard/
├── server/                  # Express.js API
│   ├── config/
│   │   ├── db.js            # PostgreSQL connection pool
│   │   ├── schema.sql       # Database schema & triggers
│   │   └── initDb.js        # Schema initialization
│   ├── middleware/
│   │   └── auth.js          # JWT middleware
│   ├── routes/
│   │   ├── auth.js          # Register, Login, Profile
│   │   ├── applications.js  # Full CRUD + status updates
│   │   └── dashboard.js     # Stats & analytics
│   ├── services/
│   │   └── emailReminder.js # Daily cron email reminders
│   └── index.js
│
└── client/                  # React + Vite SPA
    └── src/
        ├── context/AuthContext.jsx
        ├── services/api.js
        ├── components/
        │   ├── Layout.jsx
        │   └── ApplicationModal.jsx
        └── pages/
            ├── Login.jsx / Register.jsx
            ├── Dashboard.jsx
            ├── KanbanBoard.jsx
            └── Applications.jsx
```

## 🔧 Environment Variables

### Server (`server/.env`)
```env
DATABASE_URL=postgresql://user:password@localhost:5432/hireboard
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
PORT=5001
CLIENT_URL=http://localhost:5173

# Optional email reminders
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password
```

## 🚢 Deployment

- **Frontend** → [Vercel](https://vercel.com) (set `VITE_API_URL` to your Railway URL)
- **Backend + DB** → [Railway](https://railway.app) (add `DATABASE_URL` from Railway PostgreSQL)

## 📄 License

MIT © [arpittts](https://github.com/arpittts)
