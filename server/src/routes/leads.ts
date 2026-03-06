import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

interface LeadRow {
  id: number;
  institute_id: number;
  student_name: string | null;
  student_phone: string;
  message: string;
  status: string;
  created_at: string;
}

// GET /api/leads/:instituteId — return all leads for an institute
router.get('/:instituteId', async (req: Request, res: Response) => {
  const { instituteId } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM leads WHERE institute_id = $1 ORDER BY created_at DESC',
      [Number(instituteId)]
    );

    res.json(result.rows as LeadRow[]);
  } catch (err) {
    console.error('Error fetching leads:', err);
    res.status(500).json({ error: 'Failed to fetch leads.' });
  }
});

// PATCH /api/leads/:leadId/status — update a lead's status
router.patch('/:leadId/status', async (req: Request, res: Response) => {
  const { leadId } = req.params;
  const { status } = req.body as { status?: string };

  if (!status || !['new', 'contacted', 'converted', 'lost'].includes(status)) {
    res.status(400).json({ error: 'Status must be one of: new, contacted, converted, lost.' });
    return;
  }

  try {
    const result = await pool.query(
      'UPDATE leads SET status = $1 WHERE id = $2',
      [status, Number(leadId)]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Lead not found.' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error updating lead status:', err);
    res.status(500).json({ error: 'Failed to update lead status.' });
  }
});

export default router;
