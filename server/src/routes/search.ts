import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, userIdOf } from '../middleware/auth.js';
import { hybridSearch } from '../services/search.js';

const querySchema = z.object({
  q: z.string().trim().min(2, 'Type at least 2 characters.').max(200),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export const searchRouter = Router();
searchRouter.use(requireAuth);

// GET /api/search?q=chatbot%20internships
searchRouter.get('/', async (req, res) => {
  const { q, limit } = querySchema.parse(req.query);
  res.json(await hybridSearch(userIdOf(req), q, limit));
});
