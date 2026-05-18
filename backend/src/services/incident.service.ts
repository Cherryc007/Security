import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { IncidentSeverity, IncidentStatus, SOSStatus } from '@prisma/client';
import { SocketEmitter } from '../socket';
import { SocketEvents } from '@shared/socketEvents';

export class IncidentService {
  static async create(data: {
    title: string;
    description: string;
    severity: IncidentSeverity;
    siteId: string;
    floorId?: string;
    zoneId?: string;
    reportedBy: string;
  }) {
    const incident = await prisma.incident.create({
      data,
      include: {
        site: { select: { id: true, name: true } },
        floor: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true } },
        reporter: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });

    SocketEmitter.emitToSite(data.siteId, SocketEvents.INCIDENT_NEW, incident);
    SocketEmitter.emitToCommandCenter(SocketEvents.INCIDENT_NEW, incident);

    return incident;
  }

  static async update(id: string, data: {
    status?: IncidentStatus;
    assignedTo?: string;
    resolution?: string;
    severity?: IncidentSeverity;
  }) {
    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident) throw new AppError('Incident not found', 404);

    const updateData: any = { ...data };
    if (data.status === IncidentStatus.RESOLVED) {
      updateData.resolvedAt = new Date();
    }

    const updatedIncident = await prisma.incident.update({
      where: { id },
      data: updateData,
      include: {
        site: { select: { id: true, name: true } },
        floor: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true } },
        reporter: { select: { id: true, firstName: true, lastName: true, role: true } },
        assignee: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });

    SocketEmitter.emitToSite(updatedIncident.siteId, SocketEvents.INCIDENT_UPDATED, updatedIncident);
    SocketEmitter.emitToCommandCenter(SocketEvents.INCIDENT_UPDATED, updatedIncident);

    return updatedIncident;
  }

  static async getForSite(siteId: string, filters?: {
    status?: IncidentStatus;
    severity?: IncidentSeverity;
    limit?: number;
    offset?: number;
  }) {
    const where: any = { siteId };
    if (filters?.status) {
      where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
    }
    if (filters?.severity) {
      where.severity = Array.isArray(filters.severity) ? { in: filters.severity } : filters.severity;
    }

    const [incidents, count] = await Promise.all([
      prisma.incident.findMany({
        where,
        include: {
          floor: { select: { id: true, name: true } },
          zone: { select: { id: true, name: true } },
          reporter: { select: { id: true, firstName: true, lastName: true } },
          assignee: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: filters?.limit || 50,
        skip: filters?.offset || 0,
      }),
      prisma.incident.count({ where }),
    ]);

    return { incidents, total: count };
  }

  static async getById(id: string) {
    const incident = await prisma.incident.findUnique({
      where: { id },
      include: {
        site: true,
        floor: true,
        zone: true,
        reporter: { select: { id: true, firstName: true, lastName: true, role: true, phone: true } },
        assignee: { select: { id: true, firstName: true, lastName: true, role: true, phone: true } },
      },
    });

    if (!incident) throw new AppError('Incident not found', 404);
    return incident;
  }
}

export class SOSService {
  static async trigger(data: {
    userId: string;
    siteId: string;
    floorId?: string;
    zoneId?: string;
    message?: string;
    latitude?: number;
    longitude?: number;
  }) {
    // Check for existing active SOS
    const existing = await prisma.sOSAlert.findFirst({
      where: { userId: data.userId, status: SOSStatus.ACTIVE },
    });

    if (existing) throw new AppError('Active SOS already exists', 400);

    // Let's find their active zone and floor
    let floorId = data.floorId;
    let zoneId = data.zoneId;

    if (!floorId || !zoneId) {
      // Find active patrol session for this guard
      const activePatrol = await prisma.patrolSession.findFirst({
        where: { guardId: data.userId, status: 'IN_PROGRESS' },
        orderBy: { startedAt: 'desc' }
      });

      if (activePatrol) {
        // Find the last scanned checkpoint
        const lastScan = await prisma.patrolScan.findFirst({
          where: { sessionId: activePatrol.id },
          orderBy: { scannedAt: 'desc' },
          include: { checkpoint: true }
        });

        if (lastScan?.checkpoint) {
          floorId = lastScan.checkpoint.floorId;
          zoneId = lastScan.checkpoint.zoneId;
        }
      }
    }

    // Fallback to the first zone of their site if not active
    if (!floorId || !zoneId) {
      const fallbackZone = await prisma.zone.findFirst({
        where: { floor: { siteId: data.siteId } },
        select: { id: true, floorId: true }
      });
      if (fallbackZone) {
        floorId = fallbackZone.floorId;
        zoneId = fallbackZone.id;
      }
    }

    const sos = await prisma.sOSAlert.create({
      data: {
        userId: data.userId,
        siteId: data.siteId,
        floorId,
        zoneId,
        message: data.message,
        latitude: data.latitude,
        longitude: data.longitude
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true, role: true, siteId: true } },
        site: { select: { id: true, name: true } },
      },
    });

    // Lookup floor and zone names to enrich the Socket payload
    let zoneName = 'Unknown Zone';
    let floorName = 'Unknown Floor';
    if (sos.zoneId) {
      const zone = await prisma.zone.findUnique({
        where: { id: sos.zoneId },
        select: { name: true, floor: { select: { name: true } } }
      });
      if (zone) {
        zoneName = zone.name;
        floorName = zone.floor.name;
      }
    }

    const enrichedPayload = { ...sos, zoneName, floorName };

    SocketEmitter.emitToSite(data.siteId, SocketEvents.SOS_TRIGGERED, enrichedPayload);
    SocketEmitter.emitToCommandCenter(SocketEvents.SOS_TRIGGERED, enrichedPayload);
    SocketEmitter.triggerEmergencyLocationFetch(data.userId);

    return enrichedPayload;
  }

  static async respond(alertId: string) {
    const sos = await prisma.sOSAlert.update({
      where: { id: alertId },
      data: { status: SOSStatus.RESPONDING },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true } },
        site: { select: { id: true, name: true } },
      },
    });

    // Lookup zone details to include in notification message
    let zoneName = 'Unknown Zone';
    let floorName = 'Unknown Floor';
    if (sos.zoneId) {
      const zone = await prisma.zone.findUnique({
        where: { id: sos.zoneId },
        select: { name: true, floor: { select: { name: true } } }
      });
      if (zone) {
        zoneName = zone.name;
        floorName = zone.floor.name;
      }
    }

    // Find all other guards and supervisors on the same site
    const nearbyStaff = await prisma.user.findMany({
      where: {
        siteId: sos.siteId,
        id: { not: sos.userId },
        role: { in: ['GUARD', 'SUPERVISOR'] },
        isActive: true
      }
    });

    // Create a database notification and send real-time socket events for each
    const notificationTitle = `🚨 SOS RESPONSE REQUESTED`;
    const notificationMessage = `Emergency SOS at ${floorName} - ${zoneName}! Guard ${sos.user.firstName} ${sos.user.lastName} needs backup. Contact: ${sos.user.phone || 'N/A'}`;

    await Promise.all(nearbyStaff.map(async (staff) => {
      await prisma.notification.create({
        data: {
          userId: staff.id,
          title: notificationTitle,
          message: notificationMessage,
          type: 'sos',
          data: {
            sosId: sos.id,
            zoneName,
            floorName,
            reporterName: `${sos.user.firstName} ${sos.user.lastName}`,
            reporterPhone: sos.user.phone
          }
        }
      });

      SocketEmitter.emitToUser(staff.id, 'notification:new', {
        title: notificationTitle,
        message: notificationMessage,
        type: 'sos',
        data: {
          sosId: sos.id,
          zoneName,
          floorName,
          reporterName: `${sos.user.firstName} ${sos.user.lastName}`,
          reporterPhone: sos.user.phone
        }
      });
    }));

    const enrichedPayload = { ...sos, zoneName, floorName };
    SocketEmitter.emitToSite(sos.siteId, SocketEvents.SOS_TRIGGERED, enrichedPayload);
    SocketEmitter.emitToCommandCenter(SocketEvents.SOS_TRIGGERED, enrichedPayload);

    return enrichedPayload;
  }

  static async resolve(alertId: string, data: {
    resolvedBy: string;
    resolution: string;
    isFalseAlarm?: boolean;
  }) {
    const sos = await prisma.sOSAlert.update({
      where: { id: alertId },
      data: {
        status: data.isFalseAlarm ? SOSStatus.FALSE_ALARM : SOSStatus.RESOLVED,
        resolvedBy: data.resolvedBy,
        resolution: data.resolution,
        resolvedAt: new Date(),
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true } },
        site: { select: { id: true, name: true } },
      },
    });

    // Lookup zone details to include in resolved payload
    let zoneName = 'Unknown Zone';
    let floorName = 'Unknown Floor';
    if (sos.zoneId) {
      const zone = await prisma.zone.findUnique({
        where: { id: sos.zoneId },
        select: { name: true, floor: { select: { name: true } } }
      });
      if (zone) {
        zoneName = zone.name;
        floorName = zone.floor.name;
      }
    }

    const enrichedPayload = { ...sos, zoneName, floorName };

    SocketEmitter.emitToSite(sos.siteId, SocketEvents.SOS_RESOLVED, enrichedPayload);
    SocketEmitter.emitToCommandCenter(SocketEvents.SOS_RESOLVED, enrichedPayload);
    SocketEmitter.emitToUser(sos.userId, SocketEvents.LOCATION_STOP_STREAM, {});

    return enrichedPayload;
  }

  static async getActive(siteId?: string) {
    const where: any = {
      status: { in: [SOSStatus.ACTIVE, SOSStatus.RESPONDING] },
    };
    if (siteId) where.siteId = siteId;

    const alerts = await prisma.sOSAlert.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true, role: true } },
        site: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(alerts.map(async (alert) => {
      let zoneName = 'Unknown Zone';
      let floorName = 'Unknown Floor';
      if (alert.zoneId) {
        const zone = await prisma.zone.findUnique({
          where: { id: alert.zoneId },
          select: { name: true, floor: { select: { name: true } } }
        });
        if (zone) {
          zoneName = zone.name;
          floorName = zone.floor.name;
        }
      }
      return { ...alert, zoneName, floorName };
    }));
  }
}
