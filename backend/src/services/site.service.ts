import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';
import { PatrolStatus, IncidentStatus, SOSStatus } from '@prisma/client';
import path from 'path';
import fs from 'fs';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'floors');

function maxCheckpointsForZone(mapWidth: number | null, mapHeight: number | null): number {
  if (!mapWidth || !mapHeight) return 1;
  const area = mapWidth * mapHeight;
  if (area > 90000) return 3;
  if (area > 45000) return 2;
  return 1;
}

function guardInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

export class SiteService {
  static async createSite(data: { name: string; code: string; address?: string; companyId: string }) {
    return prisma.site.create({ data });
  }

  static async getSites(companyId: string) {
    return prisma.site.findMany({
      where: { companyId, isActive: true },
      include: { _count: { select: { floors: true, users: true, patrolRoutes: true } } },
      orderBy: { name: 'asc' },
    });
  }

  static async getSiteById(id: string) {
    const site = await prisma.site.findUnique({
      where: { id },
      include: {
        floors: {
          where: { isActive: true },
          include: {
            zones: { where: { isActive: true }, include: { _count: { select: { checkpoints: true } } } },
          },
          orderBy: { number: 'asc' },
        },
        _count: { select: { users: true, shifts: true, patrolRoutes: true, incidents: true } },
      },
    });
    if (!site) throw new AppError('Site not found', 404);
    return site;
  }

  static async createFloor(data: { name: string; number: number; siteId: string }) {
    return prisma.floor.create({ data, include: { zones: true } });
  }

  static async getOperationalMap(floorId: string) {
    const floor = await prisma.floor.findUnique({
      where: { id: floorId },
      include: {
        site: { select: { id: true, name: true, code: true } },
        zones: {
          where: { isActive: true },
          orderBy: { code: 'asc' },
          include: {
            checkpoints: {
              where: { isActive: true },
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                name: true,
                qrCode: true,
                mapX: true,
                mapY: true,
                sortOrder: true,
              },
            },
          },
        },
      },
    });
    if (!floor) throw new AppError('Floor not found', 404);

    const since = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const recentScans = await prisma.patrolScan.findMany({
      where: { checkpoint: { floorId }, scannedAt: { gte: since } },
      include: {
        guard: { select: { id: true, firstName: true, lastName: true } },
        checkpoint: { select: { id: true, name: true, zoneId: true, mapX: true, mapY: true } },
      },
      orderBy: { scannedAt: 'desc' },
      take: 80,
    });

    const activeGuards: {
      guardId: string;
      firstName: string;
      lastName: string;
      initials: string;
      zoneId: string;
      checkpointId: string;
      checkpointName: string;
      mapX: number;
      mapY: number;
      scannedAt: string;
      status: 'ON_PATROL' | 'STALE';
    }[] = [];
    const seenGuards = new Set<string>();
    for (const s of recentScans) {
      if (seenGuards.has(s.guardId) || s.checkpoint.mapX == null || s.checkpoint.mapY == null) continue;
      seenGuards.add(s.guardId);
      const stale = Date.now() - s.scannedAt.getTime() > 90 * 60 * 1000;
      activeGuards.push({
        guardId: s.guardId,
        firstName: s.guard.firstName,
        lastName: s.guard.lastName,
        initials: guardInitials(s.guard.firstName, s.guard.lastName),
        zoneId: s.checkpoint.zoneId,
        checkpointId: s.checkpoint.id,
        checkpointName: s.checkpoint.name,
        mapX: s.checkpoint.mapX,
        mapY: s.checkpoint.mapY,
        scannedAt: s.scannedAt.toISOString(),
        status: stale ? 'STALE' : 'ON_PATROL',
      });
    }

    const [openIncidents, activeSos, delayedPatrols] = await Promise.all([
      prisma.incident.findMany({
        where: {
          floorId,
          status: { in: [IncidentStatus.OPEN, IncidentStatus.IN_PROGRESS, IncidentStatus.ESCALATED] },
        },
        select: { id: true, title: true, severity: true, zoneId: true },
        take: 20,
      }),
      prisma.sOSAlert.findMany({
        where: { siteId: floor.siteId, status: { in: [SOSStatus.ACTIVE, SOSStatus.RESPONDING] } },
        select: { id: true, userId: true },
        take: 10,
      }),
      prisma.patrolSession.findMany({
        where: {
          route: { siteId: floor.siteId },
          status: { in: [PatrolStatus.DELAYED, PatrolStatus.MISSED] },
          scheduledAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
        select: { id: true, status: true, route: { select: { name: true } } },
        take: 15,
      }),
    ]);

    const overlays = [
      ...openIncidents.map((i) => ({
        type: 'INCIDENT' as const,
        zoneId: i.zoneId ?? undefined,
        label: i.title,
        severity: i.severity,
      })),
      ...activeSos.map(() => ({ type: 'SOS' as const, label: 'SOS ACTIVE' })),
      ...delayedPatrols.map((p) => ({
        type: 'PATROL_DELAYED' as const,
        label: `${p.route.name} — ${p.status}`,
      })),
    ];

    const cpLastScan = new Map<string, Date>();
    for (const s of recentScans) {
      if (!cpLastScan.has(s.checkpointId)) cpLastScan.set(s.checkpointId, s.scannedAt);
    }

    return {
      site: floor.site,
      floor: {
        id: floor.id,
        name: floor.name,
        number: floor.number,
        mapViewBox: floor.mapViewBox,
        layoutSvg: floor.layoutSvg,
        layoutImageUrl: floor.layoutImageUrl,
        layoutWidth: floor.layoutWidth,
        layoutHeight: floor.layoutHeight,
      },
      zones: floor.zones.map((z) => ({
        id: z.id,
        name: z.name,
        code: z.code,
        status: z.status,
        x: z.mapX,
        y: z.mapY,
        width: z.mapWidth,
        height: z.mapHeight,
        checkpoints: z.checkpoints.map((cp) => ({
          ...cp,
          lastScannedAt: cpLastScan.get(cp.id)?.toISOString() ?? null,
        })),
      })),
      activeGuards,
      overlays,
    };
  }

  static async uploadFloorLayout(
    floorId: string,
    file: { filename: string; path: string; mimetype: string },
    dimensions?: { width: number; height: number }
  ) {
    const floor = await prisma.floor.findUnique({ where: { id: floorId } });
    if (!floor) throw new AppError('Floor not found', 404);

    const ext = path.extname(file.filename).toLowerCase();
    const destName = `${floorId}${ext}`;
    const destPath = path.join(UPLOADS_DIR, destName);
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.renameSync(file.path, destPath);

    const w = dimensions?.width ?? 1000;
    const h = dimensions?.height ?? 600;
    const viewBox = `0 0 ${w} ${h}`;

    return prisma.floor.update({
      where: { id: floorId },
      data: {
        layoutImageUrl: `/api/uploads/floors/${destName}`,
        layoutWidth: w,
        layoutHeight: h,
        mapViewBox: viewBox,
      },
    });
  }

  static async updateZoneBounds(
    zoneId: string,
    bounds: { mapX: number; mapY: number; mapWidth: number; mapHeight: number }
  ) {
    return prisma.zone.update({ where: { id: zoneId }, data: bounds });
  }

  static async updateCheckpointPosition(checkpointId: string, mapX: number, mapY: number) {
    return prisma.checkpoint.update({ where: { id: checkpointId }, data: { mapX, mapY } });
  }

  static async getFloors(siteId: string) {
    return prisma.floor.findMany({
      where: { siteId, isActive: true },
      include: { zones: { where: { isActive: true } }, _count: { select: { checkpoints: true } } },
      orderBy: { number: 'asc' },
    });
  }

  static async createZone(data: { name: string; code: string; description?: string; floorId: string }) {
    return prisma.zone.create({ data, include: { floor: { include: { site: true } } } });
  }

  static async getZones(floorId: string) {
    return prisma.zone.findMany({
      where: { floorId, isActive: true },
      include: { checkpoints: { where: { isActive: true } }, _count: { select: { checkpoints: true, incidents: true } } },
    });
  }

  static async updateZoneStatus(zoneId: string, status: any) {
    return prisma.zone.update({ where: { id: zoneId }, data: { status } });
  }

  static async createCheckpoint(data: { name: string; floorId: string; zoneId: string; sortOrder?: number; mapX?: number; mapY?: number }) {
    const zone = await prisma.zone.findUnique({ where: { id: data.zoneId } });
    if (!zone) throw new AppError('Zone not found', 404);
    const count = await prisma.checkpoint.count({ where: { zoneId: data.zoneId, isActive: true } });
    const max = maxCheckpointsForZone(zone.mapWidth, zone.mapHeight);
    if (count >= max) throw new AppError(`Zone allows max ${max} checkpoint(s)`, 400);

    const qrCode = `CHKPT-${uuidv4().split('-')[0].toUpperCase()}-${uuidv4().split('-')[1].toUpperCase()}`;
    const mapX = data.mapX ?? (zone.mapX != null && zone.mapWidth ? zone.mapX + zone.mapWidth / 2 : null);
    const mapY = data.mapY ?? (zone.mapY != null && zone.mapHeight ? zone.mapY + zone.mapHeight / 2 : null);
    return prisma.checkpoint.create({
      data: {
        name: data.name,
        qrCode,
        floorId: data.floorId,
        zoneId: data.zoneId,
        sortOrder: data.sortOrder || count + 1,
        mapX,
        mapY,
      },
      include: { floor: true, zone: true },
    });
  }

  static async getCheckpoints(zoneId: string) {
    return prisma.checkpoint.findMany({
      where: { zoneId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  static async createPatrolRoute(data: { name: string; description?: string; siteId: string; estimatedDuration: number; checkpointIds: string[] }) {
    const { checkpointIds, ...routeData } = data;
    return prisma.patrolRoute.create({
      data: {
        ...routeData,
        checkpoints: { create: checkpointIds.map((id, i) => ({ checkpointId: id, sortOrder: i + 1 })) },
      },
      include: { checkpoints: { include: { checkpoint: true }, orderBy: { sortOrder: 'asc' } } },
    });
  }
}
