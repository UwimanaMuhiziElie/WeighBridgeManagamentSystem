import { Router, Request, Response } from 'express';
import { pool } from '../../db'; // <- adjust if your db export is different
import { requireAuth } from '../../middleware/auth'; // <- adjust name if different

const router = Router();

/**
 * GET /api/pricing-rules
 * Query:
 *  - limit=number (default 200, max 500)
 *  - active=true|false (default true)
 *  - branch_id=uuid (optional)
 *  - q=string (optional; searches name/material/vehicle/unit)
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const limitRaw = Number(req.query.limit ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

    const activeParam = String(req.query.active ?? 'true').toLowerCase();
    const active =
      activeParam === 'true' ? true :
      activeParam === 'false' ? false :
      true;

    const branchId = req.query.branch_id ? String(req.query.branch_id) : null;

    const q = req.query.q ? String(req.query.q).trim() : '';
    const hasQ = q.length > 0;

    // Build WHERE safely with params
    const params: any[] = [];
    let where = `WHERE is_active = $${params.push(active)}`;

    if (branchId) {
      where += ` AND branch_id = $${params.push(branchId)}`;
    }

    if (hasQ) {
      // ILIKE needs %...%
      const like = `%${q}%`;
      where += ` AND (
        name ILIKE $${params.push(like)}
        OR COALESCE(material_type,'') ILIKE $${params.push(like)}
        OR COALESCE(vehicle_type,'') ILIKE $${params.push(like)}
        OR COALESCE(unit_type,'') ILIKE $${params.push(like)}
      )`;
    }

    const sql = `
      SELECT
        id,
        branch_id,
        name,
        material_type,
        client_id,
        vehicle_type,
        min_weight,
        max_weight,
        price_per_unit,
        unit_type,
        is_active,
        priority,
        effective_from,
        effective_until,
        created_at,
        updated_at
      FROM pricing_rules
      ${where}
      ORDER BY priority DESC, created_at DESC
      LIMIT $${params.push(limit)}
    `;

    const { rows } = await pool.query(sql, params);

    return res.json({ success: true, data: rows });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to load pricing rules',
    });
  }
});

export default router;
