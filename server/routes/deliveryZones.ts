import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { round3 } from '../utils/money.js';

export const deliveryZonesRouter = Router();

// GET /api/delivery-zones - list all zones
deliveryZonesRouter.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { active_only } = req.query;

    let query = 'SELECT * FROM delivery_zones';
    const params: any[] = [];

    if (active_only === 'true' || active_only === '1') {
      query += ' WHERE active = 1';
    }

    query += ' ORDER BY name ASC';
    const zones = db.prepare(query).all(...params);
    res.json(zones);
  } catch (err) {
    console.error('[deliveryZones:list error]', err);
    res.status(500).json({ error: 'Une erreur interne est survenue lors de la récupération des zones de livraison.' });
  }
});

// GET /api/delivery-zones/:id - get zone by id
deliveryZonesRouter.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const zone = db.prepare('SELECT * FROM delivery_zones WHERE id = ?').get(req.params.id);
    if (!zone) {
      res.status(404).json({ error: 'Zone de livraison introuvable.' });
      return;
    }
    res.json(zone);
  } catch (err) {
    console.error('[deliveryZones:get error]', err);
    res.status(500).json({ error: 'Une erreur interne est survenue lors de la récupération de la zone de livraison.' });
  }
});

// POST /api/delivery-zones - create zone
deliveryZonesRouter.post('/', (req: Request, res: Response) => {
  try {
    const {
      name,
      min_order_amount = 0,
      delivery_fee = 0,
      delivery_days = null,
      active = 1
    } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Le nom de la zone est obligatoire.' });
      return;
    }

    const minAmount = round3(Number(min_order_amount) || 0);
    if (minAmount < 0) {
      res.status(400).json({ error: 'Le montant minimum doit être positif ou nul.' });
      return;
    }

    const fee = round3(Number(delivery_fee) || 0);
    if (fee < 0) {
      res.status(400).json({ error: 'Les frais de livraison doivent être positifs ou nuls.' });
      return;
    }

    const isActive = active === false || active === 0 ? 0 : 1;
    const db = getDb();
    const id = `zone-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO delivery_zones (id, name, min_order_amount, delivery_fee, delivery_days, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), minAmount, fee, delivery_days ?? null, isActive, now);

    const created = db.prepare('SELECT * FROM delivery_zones WHERE id = ?').get(id);
    res.status(201).json(created);
  } catch (err) {
    console.error('[deliveryZones:create error]', err);
    res.status(500).json({ error: 'Une erreur interne est survenue lors de la création de la zone de livraison.' });
  }
});

// PUT /api/delivery-zones/:id - update zone
deliveryZonesRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing: any = db.prepare('SELECT * FROM delivery_zones WHERE id = ?').get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Zone de livraison introuvable.' });
      return;
    }

    const { name, min_order_amount, delivery_fee, delivery_days, active } = req.body;

    let newName = existing.name;
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'Le nom de la zone ne peut pas être vide.' });
        return;
      }
      newName = name.trim();
    }

    let newMinAmount = existing.min_order_amount;
    if (min_order_amount !== undefined) {
      const parsed = Number(min_order_amount);
      if (!Number.isFinite(parsed) || parsed < 0) {
        res.status(400).json({ error: 'Le montant minimum doit être positif ou nul.' });
        return;
      }
      newMinAmount = round3(parsed);
    }

    let newFee = existing.delivery_fee;
    if (delivery_fee !== undefined) {
      const parsed = Number(delivery_fee);
      if (!Number.isFinite(parsed) || parsed < 0) {
        res.status(400).json({ error: 'Les frais de livraison doivent être positifs ou nuls.' });
        return;
      }
      newFee = round3(parsed);
    }

    const newDays = delivery_days !== undefined ? delivery_days : existing.delivery_days;
    const newActive = active !== undefined ? (active === false || active === 0 ? 0 : 1) : existing.active;

    db.prepare(`
      UPDATE delivery_zones
      SET name = ?, min_order_amount = ?, delivery_fee = ?, delivery_days = ?, active = ?
      WHERE id = ?
    `).run(newName, newMinAmount, newFee, newDays, newActive, req.params.id);

    const updated = db.prepare('SELECT * FROM delivery_zones WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('[deliveryZones:update error]', err);
    res.status(500).json({ error: 'Une erreur interne est survenue lors de la modification de la zone de livraison.' });
  }
});

// DELETE /api/delivery-zones/:id - delete zone
deliveryZonesRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing: any = db.prepare('SELECT * FROM delivery_zones WHERE id = ?').get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Zone de livraison introuvable.' });
      return;
    }

    const linkedOrder: any = db.prepare('SELECT COUNT(*) as count FROM client_orders WHERE delivery_zone_id = ?').get(req.params.id);
    if (linkedOrder?.count > 0) {
      res.status(400).json({ error: 'Impossible de supprimer cette zone car elle contient des commandes associées. Désactivez-la plutôt.' });
      return;
    }

    db.prepare('DELETE FROM delivery_zones WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[deliveryZones:delete error]', err);
    res.status(500).json({ error: 'Une erreur interne est survenue lors de la suppression de la zone de livraison.' });
  }
});
