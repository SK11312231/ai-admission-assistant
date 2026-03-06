import { Router, Request, Response } from 'express';
import db from '../db';

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
router.get('/:instituteId', (req: Request, res: Response) => {
  const { instituteId } = req.params;

  try {
    const leads = db
      .prepare('SELECT * FROM leads WHERE institute_id = ? ORDER BY created_at DESC')
      .all(Number(instituteId)) as LeadRow[];

    res.json(leads);
  } catch (err) {
    console.error('Error fetching leads:', err);
    res.status(500).json({ error: 'Failed to fetch leads.' });
  }
});

// PATCH /api/leads/:leadId/status — update a lead's status
router.patch('/:leadId/status', (req: Request, res: Response) => {
  const { leadId } = req.params;
  const { status } = req.body as { status?: string };

  if (!status || !['new', 'contacted', 'converted', 'lost'].includes(status)) {
    res.status(400).json({ error: 'Status must be one of: new, contacted, converted, lost.' });
    return;
  }

  try {
    const result = db
      .prepare('UPDATE leads SET status = ? WHERE id = ?')
      .run(status, Number(leadId));

    if (result.changes === 0) {
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
