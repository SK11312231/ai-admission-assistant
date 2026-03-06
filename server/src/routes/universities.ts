import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

interface University {
  id: number;
  name: string;
  location: string;
  ranking: number;
  acceptance_rate: number;
  programs: string; // JSON string
  description: string;
}

// GET /api/universities — return all universities ordered by ranking
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM universities ORDER BY ranking ASC');
    const universities = result.rows as University[];

    // Parse programs JSON for each university
    const parsed = universities.map((u) => ({
      ...u,
      programs: JSON.parse(u.programs) as string[],
    }));

    res.json(parsed);
  } catch (err) {
    console.error('Error fetching universities:', err);
    res.status(500).json({ error: 'Failed to fetch universities.' });
  }
});

// GET /api/universities/:id — return a single university
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM universities WHERE id = $1', [id]);
    const university = result.rows[0] as University | undefined;

    if (!university) {
      res.status(404).json({ error: 'University not found.' });
      return;
    }

    res.json({
      ...university,
      programs: JSON.parse(university.programs) as string[],
    });
  } catch (err) {
    console.error('Error fetching university:', err);
    res.status(500).json({ error: 'Failed to fetch university.' });
  }
});

export default router;
