import { Router, Request, Response } from 'express';
import { authenticate, authorizeMinRole } from '../middleware/auth';
import { AttendanceService } from '../services/attendance.service';
import { SocketEmitter } from '../socket';
import { SocketEvents } from '@shared/socketEvents';
import prisma from '../config/database';

const router = Router();
router.use(authenticate);

router.post('/clock-in', async (req: Request, res: Response) => {
  try {
    const record = await AttendanceService.clockIn(req.user!.userId);
    
    const fullUser = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, firstName: true, lastName: true, employeeId: true, role: true, siteId: true }
    });

    if (fullUser && fullUser.siteId) {
      const payload = {
        id: record.id,
        userId: record.userId,
        name: `${fullUser.firstName} ${fullUser.lastName}`,
        employeeId: fullUser.employeeId,
        role: fullUser.role,
        status: record.status,
        clockIn: record.clockIn ? new Date(record.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '-',
        clockOut: '-',
        hours: '-'
      };
      
      SocketEmitter.emitToSite(fullUser.siteId, SocketEvents.ATTENDANCE_UPDATE, payload);
      SocketEmitter.emitToCommandCenter(SocketEvents.ATTENDANCE_UPDATE, payload);
    }

    res.json(record);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.post('/clock-out', async (req: Request, res: Response) => {
  try {
    const record = await AttendanceService.clockOut(req.user!.userId);
    
    const fullUser = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, firstName: true, lastName: true, employeeId: true, role: true, siteId: true }
    });

    if (fullUser && fullUser.siteId) {
      const payload = {
        id: record.id,
        userId: record.userId,
        name: `${fullUser.firstName} ${fullUser.lastName}`,
        employeeId: fullUser.employeeId,
        role: fullUser.role,
        status: record.status,
        clockIn: record.clockIn ? new Date(record.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '-',
        clockOut: record.clockOut ? new Date(record.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '-',
        hours: record.totalHours ? `${record.totalHours}h` : '-'
      };
      
      SocketEmitter.emitToSite(fullUser.siteId, SocketEvents.ATTENDANCE_UPDATE, payload);
      SocketEmitter.emitToCommandCenter(SocketEvents.ATTENDANCE_UPDATE, payload);
    }

    res.json(record);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.get('/site/:siteId', authorizeMinRole('SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const date = req.query.date ? new Date(req.query.date as string) : undefined;
    const records = await AttendanceService.getForSite(req.params.siteId as string, date);
    res.json(records);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.get('/my', async (req: Request, res: Response) => {
  try {
    if (!req.query.start && !req.query.end) {
      const records = await prisma.attendance.findMany({
        where: { userId: req.user!.userId },
        orderBy: { date: 'desc' },
        take: 10
      });
      res.json(records);
      return;
    }
    const start = new Date(req.query.start as string);
    const end = new Date(req.query.end as string);
    const records = await AttendanceService.getForUser(req.user!.userId, start, end);
    res.json(records);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.get('/overview/:siteId', authorizeMinRole('SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const date = req.query.date ? new Date(req.query.date as string) : undefined;
    const overview = await AttendanceService.getSiteOverview(req.params.siteId as string, date);
    res.json(overview);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

export default router;
