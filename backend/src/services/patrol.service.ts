import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { PatrolStatus } from '@prisma/client';
import { SocketEmitter } from '../socket';
import { SocketEvents } from '@shared/socketEvents';

export class PatrolService {
  /** Mark overdue PENDING as MISSED; long IN_PROGRESS as DELAYED */
  static async evaluateSessionStatuses(
    sessions: { id: string; status: PatrolStatus; scheduledAt: Date; startedAt: Date | null; route?: { estimatedDuration: number } }[]
  ) {
    const now = Date.now();
    for (const session of sessions) {
      const estMs = (session.route?.estimatedDuration ?? 60) * 60_000;
      if (session.status === PatrolStatus.PENDING) {
        const deadline = session.scheduledAt.getTime() + estMs;
        if (now > deadline) {
          await prisma.patrolSession.update({
            where: { id: session.id },
            data: { status: PatrolStatus.MISSED },
          });
          session.status = PatrolStatus.MISSED;
        }
      } else if (session.status === PatrolStatus.IN_PROGRESS && session.startedAt) {
        const deadline = session.startedAt.getTime() + estMs * 1.25;
        if (now > deadline) {
          await prisma.patrolSession.update({
            where: { id: session.id },
            data: { status: PatrolStatus.DELAYED },
          });
          session.status = PatrolStatus.DELAYED;
        }
      }
    }
  }

  static async getRoutes(siteId: string) {
    return prisma.patrolRoute.findMany({
      where: { siteId, isActive: true },
      include: {
        checkpoints: {
          include: { checkpoint: { include: { zone: true, floor: true } } },
          orderBy: { sortOrder: 'asc' },
        },
        _count: { select: { patrolSessions: true } },
      },
    });
  }

  static async getGuardSessions(guardId: string, date?: Date) {
    const startOfDay = date ? new Date(date) : new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    const sessions = await prisma.patrolSession.findMany({
      where: {
        guardId,
        scheduledAt: { gte: startOfDay, lte: endOfDay },
      },
      include: {
        route: {
          include: {
            checkpoints: {
              include: { checkpoint: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
        scans: { include: { checkpoint: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
    await this.evaluateSessionStatuses(sessions);
    return sessions;
  }

  static async startPatrol(sessionId: string, guardId: string) {
    const session = await prisma.patrolSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) throw new AppError('Patrol session not found', 404);
    if (session.guardId !== guardId) throw new AppError('Not assigned to this patrol', 403);
    if (session.status !== PatrolStatus.PENDING) {
      throw new AppError('Patrol already started or completed', 400);
    }

    await prisma.patrolSession.update({
      where: { id: sessionId },
      data: { status: PatrolStatus.IN_PROGRESS, startedAt: new Date() },
    });

    const updatedSession = await prisma.patrolSession.findUnique({
      where: { id: sessionId },
      include: {
        route: true,
        guard: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        scans: { include: { checkpoint: true } },
      },
    });
    if (!updatedSession) throw new AppError('Patrol session not found', 404);

    SocketEmitter.emitToSite(updatedSession.route.siteId, SocketEvents.PATROL_STARTED, updatedSession);
    SocketEmitter.emitToPatrol(sessionId, SocketEvents.PATROL_STARTED, updatedSession);
    SocketEmitter.emitToCommandCenter(SocketEvents.PATROL_STARTED, updatedSession);
    SocketEmitter.emitToCommandCenter(SocketEvents.PATROL_PROGRESS, updatedSession);

    return updatedSession;
  }

  static async scanCheckpoint(data: {
    sessionId: string;
    checkpointId: string;
    guardId: string;
    qrCode: string;
    notes?: string;
  }) {
    const session = await prisma.patrolSession.findUnique({
      where: { id: data.sessionId },
      include: {
        route: { include: { checkpoints: true } },
        scans: true,
      },
    });

    if (!session) throw new AppError('Patrol session not found', 404);
    if (session.guardId !== data.guardId) throw new AppError('Not assigned to this patrol', 403);
    if (session.status !== PatrolStatus.IN_PROGRESS) {
      throw new AppError('Patrol not in progress', 400);
    }

    // Verify checkpoint belongs to route
    const checkpoint = await prisma.checkpoint.findUnique({
      where: { qrCode: data.qrCode },
    });

    if (!checkpoint) throw new AppError('Invalid QR code', 400);

    const routeCheckpoint = session.route.checkpoints.find(
      rc => rc.checkpointId === checkpoint.id
    );
    if (!routeCheckpoint) throw new AppError('Checkpoint not part of this route', 400);

    // Check not already scanned
    const alreadyScanned = session.scans.find(s => s.checkpointId === checkpoint.id);
    if (alreadyScanned) throw new AppError('Checkpoint already scanned', 400);

    // Create scan
    const scan = await prisma.patrolScan.create({
      data: {
        sessionId: data.sessionId,
        checkpointId: checkpoint.id,
        guardId: data.guardId,
        notes: data.notes,
      },
      include: { checkpoint: { include: { zone: true, floor: true } } },
    });

    // Update completion percentage
    const totalCheckpoints = session.route.checkpoints.length;
    const scannedCount = session.scans.length + 1;
    const completionPct = (scannedCount / totalCheckpoints) * 100;

    const updateData: any = { completionPct };
    if (completionPct >= 100) {
      updateData.status = PatrolStatus.COMPLETED;
      updateData.completedAt = new Date();
    }

    await prisma.patrolSession.update({
      where: { id: data.sessionId },
      data: updateData,
    });

    const progressPayload = await prisma.patrolSession.findUnique({
      where: { id: data.sessionId },
      include: {
        route: true,
        guard: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        scans: { include: { checkpoint: true } },
      },
    });
    if (!progressPayload) throw new AppError('Patrol session not found', 404);
    SocketEmitter.emitToSite(session.route.siteId, SocketEvents.PATROL_SCANNED, {
      sessionId: data.sessionId,
      scan,
      completionPct,
      isComplete: completionPct >= 100,
    });
    SocketEmitter.emitToPatrol(data.sessionId, SocketEvents.PATROL_PROGRESS, progressPayload);
    SocketEmitter.emitToCommandCenter(SocketEvents.PATROL_PROGRESS, progressPayload);

    const cp = scan.checkpoint;
    if (cp.mapX != null && cp.mapY != null) {
      const guardPayload = {
        guardId: data.guardId,
        firstName: progressPayload.guard.firstName,
        lastName: progressPayload.guard.lastName,
        initials: `${progressPayload.guard.firstName.charAt(0)}${progressPayload.guard.lastName.charAt(0)}`.toUpperCase(),
        zoneId: cp.zoneId,
        checkpointId: cp.id,
        checkpointName: cp.name,
        mapX: cp.mapX,
        mapY: cp.mapY,
        scannedAt: scan.scannedAt.toISOString(),
        status: 'ON_PATROL' as const,
        floorId: cp.floorId,
      };
      SocketEmitter.emitToSite(session.route.siteId, SocketEvents.GUARD_OPERATIONAL, guardPayload);
      SocketEmitter.emitToCommandCenter(SocketEvents.GUARD_OPERATIONAL, guardPayload);
      if (cp.zoneId) SocketEmitter.emitToZone(cp.zoneId, SocketEvents.GUARD_OPERATIONAL, guardPayload);
    }

    return { scan, session: progressPayload, completionPct, isComplete: completionPct >= 100 };
  }

  static async getSitePatrolOverview(siteId: string, date?: Date) {
    const startOfDay = date ? new Date(date) : new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    const sessions = await prisma.patrolSession.findMany({
      where: {
        route: { siteId },
        scheduledAt: { gte: startOfDay, lte: endOfDay },
      },
      include: {
        route: true,
        guard: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        scans: true,
      },
    });

    await this.evaluateSessionStatuses(sessions);

    const total = sessions.length;
    const completed = sessions.filter(s => s.status === PatrolStatus.COMPLETED).length;
    const inProgress = sessions.filter(s => s.status === PatrolStatus.IN_PROGRESS).length;
    const missed = sessions.filter(s => s.status === PatrolStatus.MISSED).length;
    const pending = sessions.filter(s => s.status === PatrolStatus.PENDING).length;

    return { total, completed, inProgress, missed, pending, sessions };
  }

  static async createSession(data: {
    routeId: string;
    guardId: string;
    scheduledAt: Date;
  }) {
    return prisma.patrolSession.create({
      data: {
        routeId: data.routeId,
        guardId: data.guardId,
        scheduledAt: data.scheduledAt,
      },
      include: {
        route: true,
        guard: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }
}
