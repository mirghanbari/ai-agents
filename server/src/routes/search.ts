import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { runDirectSearch } from '../agent';

const router = express.Router();

const SearchRequestSchema = z.object({
  sources: z
    .array(z.enum(['flights', 'hotels', 'airbnb', 'vrbo', 'cars', 'activities']))
    .min(1),
  origin: z.string().optional(),
  destination: z.string().min(1),
  departDate: z.string().min(1),
  returnDate: z.string().optional(),
  adults: z.number().int().positive(),
  children: z.number().int().nonnegative().optional(),
  maxPricePerNight: z.number().positive().optional(),
  minStars: z.number().min(1).max(5).optional(),
  carCategory: z.enum(['economy', 'compact', 'midsize', 'suv', 'luxury', 'any']).optional(),
  cabin: z.enum(['economy', 'premium_economy', 'business', 'first']).optional(),
  activityCategory: z.string().optional(),
});

// POST /api/search — direct, non-AI fan-out. Useful for re-searching from the UI.
router.post('/', async (req: Request, res: Response) => {
  const parsed = SearchRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    return;
  }

  try {
    const results = await runDirectSearch(parsed.data);
    res.json(results);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
