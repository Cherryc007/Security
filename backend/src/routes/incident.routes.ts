import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, authorizeMinRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { IncidentService, SOSService } from '../services/incident.service';

const router = Router();
router.use(authenticate);

// ─── INCIDENTS ────────────────────────────────────
router.post('/', validate(z.object({
  title: z.string().min(1), description: z.string().min(1),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  siteId: z.string().uuid(), floorId: z.string().uuid().optional(), zoneId: z.string().uuid().optional(),
})), async (req: Request, res: Response) => {
  try {
    const incident = await IncidentService.create({ ...req.body, reportedBy: req.user!.userId });
    res.status(201).json(incident);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.get('/site/:siteId', async (req: Request, res: Response) => {
  try {
    const result = await IncidentService.getForSite(req.params.siteId as string, {
      status: req.query.status as any, severity: req.query.severity as any,
      limit: parseInt(req.query.limit as string) || 50,
      offset: parseInt(req.query.offset as string) || 0,
    });
    res.json(result);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const incident = await IncidentService.getById(req.params.id as string);
    res.json(incident);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.patch('/:id', authorizeMinRole('SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const incident = await IncidentService.update(req.params.id as string, req.body);
    res.json(incident);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

// ─── SOS ──────────────────────────────────────────
router.post('/sos', validate(z.object({
  siteId: z.string().uuid(),
  floorId: z.string().uuid().optional(),
  zoneId: z.string().uuid().optional(),
  message: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
})), async (req: Request, res: Response) => {
  try {
    const alert = await SOSService.trigger({ ...req.body, userId: req.user!.userId });
    res.status(201).json(alert);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.post('/sos/:id/respond', authorizeMinRole('SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const alert = await SOSService.respond(req.params.id as string);
    res.json(alert);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.post('/sos/:id/resolve', authorizeMinRole('SUPERVISOR'), validate(z.object({
  resolution: z.string().min(1), isFalseAlarm: z.boolean().optional(),
})), async (req: Request, res: Response) => {
  try {
    const alert = await SOSService.resolve(req.params.id as string, { ...req.body, resolvedBy: req.user!.userId });
    res.json(alert);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.get('/sos/active', async (req: Request, res: Response) => {
  try {
    const siteId = req.query.siteId as string | undefined;
    const alerts = await SOSService.getActive(siteId);
    res.json(alerts);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

export default router;
