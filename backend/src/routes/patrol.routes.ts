import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, authorizeMinRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { PatrolService } from '../services/patrol.service';
import prisma from '../config/database';

const router = Router();
router.use(authenticate);

router.get('/routes/:siteId', async (req: Request, res: Response) => {
  try {
    const routes = await PatrolService.getRoutes(req.params.siteId as string);
    res.json(routes);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.get('/sessions/my', async (req: Request, res: Response) => {
  try {
    const date = req.query.date ? new Date(req.query.date as string) : undefined;
    const sessions = await PatrolService.getGuardSessions(req.user!.userId, date);
    res.json(sessions);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.post('/sessions', authorizeMinRole('SUPERVISOR'), validate(z.object({
  routeId: z.string().uuid(), guardId: z.string().uuid(), scheduledAt: z.string().datetime(),
})), async (req: Request, res: Response) => {
  try {
    const session = await PatrolService.createSession({
      ...req.body, scheduledAt: new Date(req.body.scheduledAt),
    });
    res.status(201).json(session);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.post('/sessions/:id/start', async (req: Request, res: Response) => {
  try {
    const session = await PatrolService.startPatrol(req.params.id as string, req.user!.userId);
    res.json(session);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.post('/sessions/:id/scan', validate(z.object({
  qrCode: z.string().min(1), notes: z.string().optional(),
})), async (req: Request, res: Response) => {
  try {
    const result = await PatrolService.scanCheckpoint({
      sessionId: req.params.id as string,
      checkpointId: '',
      guardId: req.user!.userId,
      qrCode: req.body.qrCode,
      notes: req.body.notes,
    });
    res.json(result);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.patch('/sessions/:id', authorizeMinRole('SUPERVISOR'), validate(z.object({
  guardId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime().optional(),
})), async (req: Request, res: Response) => {
  try {
    const data: any = {};
    if (req.body.guardId) data.guardId = req.body.guardId;
    if (req.body.routeId) data.routeId = req.body.routeId;
    if (req.body.scheduledAt) data.scheduledAt = new Date(req.body.scheduledAt);

    const updated = await prisma.patrolSession.update({
      where: { id: req.params.id as string },
      data,
      include: {
        route: true,
        guard: { select: { id: true, firstName: true, lastName: true } }
      }
    });
    res.json(updated);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.delete('/sessions/:id', authorizeMinRole('SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    await prisma.patrolSession.delete({
      where: { id: req.params.id as string }
    });
    res.json({ message: 'Patrol session assignment deleted successfully' });
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.get('/overview/:siteId', authorizeMinRole('SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const date = req.query.date ? new Date(req.query.date as string) : undefined;
    const overview = await PatrolService.getSitePatrolOverview(req.params.siteId as string, date);
    res.json(overview);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

export default router;
