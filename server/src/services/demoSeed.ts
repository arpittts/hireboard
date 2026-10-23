import type pg from 'pg';

// Synthetic data for "Try the demo". Every company, person and link is made up
// (example.com addresses), and dates are relative to today so the dashboard
// always looks current.

type Status = 'wishlist' | 'applied' | 'interview' | 'offer' | 'rejected' | 'accepted' | 'withdrawn';

interface DemoApplication {
  company: string;
  role: string;
  type: 'job' | 'internship' | 'freelance' | 'contract';
  priority: 'low' | 'medium' | 'high';
  location: string;
  salary?: string;
  appliedDaysAgo: number;
  // Status changes after "applied", as [status, days after applying, note].
  path: [Status, number, string][];
  followUpInDays?: number;
  deadlineInDays?: number;
  contact?: { name: string; email: string };
  notes?: string;
}

const DEMO_APPLICATIONS: DemoApplication[] = [
  {
    company: 'Northwind Analytics', role: 'AI Engineer Intern', type: 'internship', priority: 'high',
    location: 'Bengaluru (hybrid)', salary: '₹45k/month stipend', appliedDaysAgo: 12,
    path: [['interview', 6, 'Recruiter screen booked']], followUpInDays: 2,
    contact: { name: 'Meera Kapoor', email: 'meera.kapoor@example.com' },
    notes: 'Team builds LLM features for retail analytics. Second round is a take-home on RAG.',
  },
  {
    company: 'Bluepeak AI', role: 'Machine Learning Intern', type: 'internship', priority: 'high',
    location: 'Remote', salary: '₹40k/month stipend', appliedDaysAgo: 30,
    path: [['interview', 8, 'Technical round 1'], ['offer', 21, 'Offer received, 6 months']],
    contact: { name: 'Rahul Menon', email: 'rahul.menon@example.com' },
    notes: 'Offer deadline in a week. Compare with Northwind before deciding.', deadlineInDays: 6,
  },
  {
    company: 'Lumen Robotics', role: 'Software Engineer Intern', type: 'internship', priority: 'medium',
    location: 'Pune', appliedDaysAgo: 45,
    path: [['interview', 10, 'Online assessment cleared'], ['rejected', 24, 'Rejected after system design round']],
    notes: 'Feedback: practise concurrency questions.',
  },
  {
    company: 'Quillstack', role: 'Backend Developer Intern', type: 'internship', priority: 'medium',
    location: 'Gurugram', salary: '₹30k/month stipend', appliedDaysAgo: 5, path: [], followUpInDays: 5,
  },
  {
    company: 'Harbor Health Tech', role: 'Data Science Intern', type: 'internship', priority: 'low',
    location: 'Hyderabad', appliedDaysAgo: 60,
    path: [['rejected', 14, 'Position filled']],
  },
  {
    company: 'Orbitline', role: 'Full Stack Developer', type: 'job', priority: 'medium',
    location: 'Noida', salary: '₹8–10 LPA', appliedDaysAgo: 20, path: [], followUpInDays: 0,
    contact: { name: 'Sana Iqbal', email: 'sana.iqbal@example.com' },
  },
  {
    company: 'Fernway Labs', role: 'Generative AI Intern', type: 'internship', priority: 'high',
    location: 'Remote', appliedDaysAgo: 2, path: [], deadlineInDays: 10,
    notes: 'Referred by a senior from college.',
  },
  {
    company: 'Cobalt Fintech', role: 'Platform Engineer Intern', type: 'internship', priority: 'medium',
    location: 'Mumbai', appliedDaysAgo: 75,
    path: [['interview', 12, 'Two rounds'], ['offer', 30, 'Offer'], ['accepted', 33, 'Accepted for the summer']],
  },
  {
    company: 'Tidewater Games', role: 'Gameplay Programmer (Contract)', type: 'contract', priority: 'low',
    location: 'Remote', appliedDaysAgo: 90,
    path: [['withdrawn', 9, 'Withdrew: timing clashed with exams']],
  },
  {
    company: 'Paperkite', role: 'Frontend Developer (Freelance)', type: 'freelance', priority: 'low',
    location: 'Remote', salary: '₹25k project', appliedDaysAgo: 0, path: [],
    notes: 'Saved from a job board. Apply after updating the portfolio.',
  },
  {
    company: 'Brightloom', role: 'Applied AI Intern', type: 'internship', priority: 'high',
    location: 'Bengaluru', appliedDaysAgo: 18,
    path: [['interview', 9, 'Hiring manager round next week']], followUpInDays: 4,
  },
  {
    company: 'Kestrel Data', role: 'Data Engineer Intern', type: 'internship', priority: 'medium',
    location: 'Chennai', appliedDaysAgo: 110, path: [],
  },
];

// Paperkite is only on the wishlist; it hasn't been applied to yet.
const WISHLIST = new Set(['Paperkite']);

const dayOffset = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export async function seedDemoData(client: pg.PoolClient, userId: string): Promise<void> {
  for (const demo of DEMO_APPLICATIONS) {
    const firstStatus: Status = WISHLIST.has(demo.company) ? 'wishlist' : 'applied';
    const finalStatus = demo.path.length ? demo.path[demo.path.length - 1][0] : firstStatus;
    const appliedOn = dayOffset(-demo.appliedDaysAgo);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO applications (user_id, company_name, role, type, status, priority, location, salary,
         application_date, deadline, follow_up_date, url, contact_name, contact_email, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $9::date + time '10:00')
       RETURNING id`,
      [
        userId, demo.company, demo.role, demo.type, finalStatus, demo.priority, demo.location, demo.salary ?? null,
        appliedOn,
        demo.deadlineInDays === undefined ? null : dayOffset(demo.deadlineInDays),
        demo.followUpInDays === undefined ? null : dayOffset(demo.followUpInDays),
        'https://example.com/careers',
        demo.contact?.name ?? null, demo.contact?.email ?? null, demo.notes ?? null,
      ],
    );
    const appId = inserted.rows[0].id;

    // History: created, then each status change on its own day.
    let previous: Status = firstStatus;
    await client.query(
      `INSERT INTO status_history (application_id, from_status, to_status, note, changed_at)
       VALUES ($1, NULL, $2, 'Application created', $3::date + time '10:00')`,
      [appId, firstStatus, appliedOn],
    );
    for (const [status, daysAfter, note] of demo.path) {
      await client.query(
        `INSERT INTO status_history (application_id, from_status, to_status, note, changed_at)
         VALUES ($1, $2, $3, $4, $5::date + time '15:30')`,
        [appId, previous, status, note, dayOffset(-demo.appliedDaysAgo + daysAfter)],
      );
      previous = status;
    }
  }
}

export const DEMO_APPLICATION_COUNT = DEMO_APPLICATIONS.length;
