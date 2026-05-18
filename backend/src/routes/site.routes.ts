import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, authorizeMinRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { SiteService } from '../services/site.service';
import { floorLayoutUpload } from '../middleware/upload';
import path from 'path';
import fs from 'fs';

const router = Router();
router.use(authenticate);

// ─── SITES ────────────────────────────────────────
router.get('/sites', async (req: Request, res: Response) => {
  try {
    const sites = await SiteService.getSites(req.user!.companyId);
    res.json(sites);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.get('/sites/:id', async (req: Request, res: Response) => {
  try {
    const site = await SiteService.getSiteById(req.params.id as string);
    res.json(site);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.post('/sites', authorizeMinRole('ADMIN'), validate(z.object({
  name: z.string().min(1), code: z.string().min(1), address: z.string().optional(),
})), async (req: Request, res: Response) => {
  try {
    const site = await SiteService.createSite({ ...req.body, companyId: req.user!.companyId });
    res.status(201).json(site);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

// ─── FLOORS ───────────────────────────────────────
router.post('/floors/:floorId/layout', authorizeMinRole('ADMIN'), floorLayoutUpload.single('layout'), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'Layout file required' }); return; }
    if (req.file.mimetype === 'application/pdf') {
      fs.unlinkSync(req.file.path);
      res.status(400).json({ error: 'Export PDF to PNG/JPG before upload' });
      return;
    }
    const width = req.body.width ? parseInt(req.body.width, 10) : undefined;
    const height = req.body.height ? parseInt(req.body.height, 10) : undefined;
    const floor = await SiteService.uploadFloorLayout(
      req.params.floorId as string,
      req.file,
      width && height ? { width, height } : undefined
    );
    res.json(floor);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.patch('/zones/:zoneId/bounds', authorizeMinRole('SUPERVISOR'), validate(z.object({
  mapX: z.number(), mapY: z.number(), mapWidth: z.number().positive(), mapHeight: z.number().positive(),
})), async (req: Request, res: Response) => {
  try {
    const zone = await SiteService.updateZoneBounds(req.params.zoneId as string, req.body);
    res.json(zone);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.patch('/checkpoints/:checkpointId/position', authorizeMinRole('SUPERVISOR'), validate(z.object({
  mapX: z.number(), mapY: z.number(),
})), async (req: Request, res: Response) => {
  try {
    const cp = await SiteService.updateCheckpointPosition(req.params.checkpointId as string, req.body.mapX, req.body.mapY);
    res.json(cp);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.get('/floors/:floorId/operational-map', async (req: Request, res: Response) => {
  try {
    const map = await SiteService.getOperationalMap(req.params.floorId as string);
    res.json(map);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.get('/sites/:siteId/floors', async (req: Request, res: Response) => {
  try {
    const floors = await SiteService.getFloors(req.params.siteId as string);
    res.json(floors);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.post('/sites/:siteId/floors', authorizeMinRole('ADMIN'), validate(z.object({
  name: z.string().min(1), number: z.number().int(),
})), async (req: Request, res: Response) => {
  try {
    const floor = await SiteService.createFloor({ ...req.body, siteId: req.params.siteId as string });
    res.status(201).json(floor);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

// ─── ZONES ────────────────────────────────────────
router.get('/floors/:floorId/zones', async (req: Request, res: Response) => {
  try {
    const zones = await SiteService.getZones(req.params.floorId as string);
    res.json(zones);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.post('/floors/:floorId/zones', authorizeMinRole('SUPERVISOR'), validate(z.object({
  name: z.string().min(1), code: z.string().min(1), description: z.string().optional(),
})), async (req: Request, res: Response) => {
  try {
    const zone = await SiteService.createZone({ ...req.body, floorId: req.params.floorId as string });
    res.status(201).json(zone);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

// ─── CHECKPOINTS ──────────────────────────────────
router.get('/zones/:zoneId/checkpoints', async (req: Request, res: Response) => {
  try {
    const checkpoints = await SiteService.getCheckpoints(req.params.zoneId as string);
    res.json(checkpoints);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.post('/zones/:zoneId/checkpoints', authorizeMinRole('SUPERVISOR'), validate(z.object({
  name: z.string().min(1),
  floorId: z.string().uuid(),
  sortOrder: z.number().int().optional(),
  mapX: z.number().optional(),
  mapY: z.number().optional(),
})), async (req: Request, res: Response) => {
  try {
    const cp = await SiteService.createCheckpoint({ ...req.body, zoneId: req.params.zoneId as string });
    res.status(201).json(cp);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

// ─── PATROL ROUTES ────────────────────────────────
router.post('/sites/:siteId/patrol-routes', authorizeMinRole('SUPERVISOR'), validate(z.object({
  name: z.string().min(1), description: z.string().optional(),
  estimatedDuration: z.number().int().positive(), checkpointIds: z.array(z.string().uuid()),
})), async (req: Request, res: Response) => {
  try {
    const route = await SiteService.createPatrolRoute({ ...req.body, siteId: req.params.siteId as string });
    res.status(201).json(route);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

export default router;
