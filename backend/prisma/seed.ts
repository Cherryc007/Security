import {
  PrismaClient,
  Role,
  PatrolStatus,
  IncidentSeverity,
  IncidentStatus,
  AttendanceStatus,
  ShiftStatus,
  Floor,
  Zone,
  Checkpoint,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function upsertShift(siteId: string, name: string, startTime: string, endTime: string) {
  const existing = await prisma.shift.findFirst({ where: { siteId, name } });
  if (existing) return existing;
  return prisma.shift.create({ data: { siteId, name, startTime, endTime } });
}

async function main() {
  console.log('🌱 Seeding database...\n');

  const company = await prisma.company.upsert({
    where: { code: 'SECUROPS-HQ' },
    update: {},
    create: {
      name: 'SecurOps Security Services',
      code: 'SECUROPS-HQ',
      address: '100 Security Boulevard, Operations City',
      phone: '+1-555-0100',
      email: 'ops@securops.com',
    },
  });

  const site = await prisma.site.upsert({
    where: { companyId_code: { companyId: company.id, code: 'TOWER-1' } },
    update: {},
    create: {
      name: 'Apex Tower Complex',
      code: 'TOWER-1',
      address: '1 Apex Plaza, Downtown',
      companyId: company.id,
    },
  });

  const floorData = [
    { name: 'Ground Floor', number: 0 },
    { name: 'Floor 1', number: 1 },
    { name: 'Floor 2', number: 2 },
    { name: 'Floor 3', number: 3 },
    { name: 'Basement', number: -1 },
  ];

  const floors: Floor[] = [];
  for (const f of floorData) {
    floors.push(
      await prisma.floor.upsert({
        where: { siteId_number: { siteId: site.id, number: f.number } },
        update: {},
        create: { ...f, siteId: site.id },
      })
    );
  }

  const zoneConfigs = [
    { floorIdx: 0, zones: [{ name: 'Main Lobby', code: 'G-LOBBY' }, { name: 'Parking Entrance', code: 'G-PARK' }, { name: 'Reception', code: 'G-RECEP' }] },
    { floorIdx: 1, zones: [{ name: 'East Wing', code: 'F1-EAST' }, { name: 'West Wing', code: 'F1-WEST' }, { name: 'Server Room', code: 'F1-SRV' }] },
    { floorIdx: 2, zones: [{ name: 'Office Area A', code: 'F2-OFA' }, { name: 'Office Area B', code: 'F2-OFB' }] },
    { floorIdx: 3, zones: [{ name: 'Executive Suite', code: 'F3-EXEC' }, { name: 'Conference Center', code: 'F3-CONF' }] },
    { floorIdx: 4, zones: [{ name: 'Storage', code: 'B-STOR' }, { name: 'Utility Room', code: 'B-UTIL' }] },
  ];

  const allZones: Zone[] = [];
  for (const config of zoneConfigs) {
    for (const z of config.zones) {
      allZones.push(
        await prisma.zone.upsert({
          where: { floorId_code: { floorId: floors[config.floorIdx].id, code: z.code } },
          update: {},
          create: { ...z, floorId: floors[config.floorIdx].id },
        })
      );
    }
  }

  const checkpoints: Checkpoint[] = [];
  for (const zone of allZones) {
    const cpNames = [`${zone.name} Entry`, `${zone.name} Center`, `${zone.name} Exit`];
    for (let i = 0; i < cpNames.length; i++) {
      checkpoints.push(
        await prisma.checkpoint.upsert({
          where: { qrCode: `CHKPT-${zone.code}-${i + 1}` },
          update: {},
          create: {
            name: cpNames[i],
            qrCode: `CHKPT-${zone.code}-${i + 1}`,
            floorId: zone.floorId,
            zoneId: zone.id,
            sortOrder: i + 1,
          },
        })
      );
    }
  }

  const passwordHash = await bcrypt.hash('SecurOps2024!', 12);
  const userDefs = [
    { employeeId: 'SEC-ADMIN01', email: 'admin@securops.com', firstName: 'Marcus', lastName: 'Chen', role: Role.SUPER_ADMIN },
    { employeeId: 'SEC-ADMIN02', email: 'ops@securops.com', firstName: 'Sarah', lastName: 'Mitchell', role: Role.ADMIN },
    { employeeId: 'SEC-CMD01', email: 'command@securops.com', firstName: 'James', lastName: 'Rodriguez', role: Role.COMMAND_OPS },
    { employeeId: 'SEC-SUP01', email: 'supervisor@securops.com', firstName: 'Diana', lastName: 'Park', role: Role.SUPERVISOR },
    { employeeId: 'SEC-GRD01', email: 'guard1@securops.com', firstName: 'Alex', lastName: 'Thompson', role: Role.GUARD },
    { employeeId: 'SEC-GRD02', email: 'guard2@securops.com', firstName: 'Michael', lastName: 'Rivera', role: Role.GUARD },
    { employeeId: 'SEC-GRD03', email: 'guard3@securops.com', firstName: 'Emily', lastName: 'Watson', role: Role.GUARD },
    { employeeId: 'SEC-GRD04', email: 'guard4@securops.com', firstName: 'Robert', lastName: 'Kim', role: Role.GUARD },
  ];

  const users: Record<string, { id: string }> = {};
  for (const u of userDefs) {
    const row = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash, companyId: company.id, siteId: site.id },
    });
    users[u.email] = row;
  }

  const morningShift = await upsertShift(site.id, 'Morning Shift', '06:00', '14:00');
  await upsertShift(site.id, 'Afternoon Shift', '14:00', '22:00');
  await upsertShift(site.id, 'Night Shift', '22:00', '06:00');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const email of ['guard1@securops.com', 'guard2@securops.com', 'guard3@securops.com', 'guard4@securops.com']) {
    await prisma.shiftAssignment.upsert({
      where: {
        shiftId_userId_date: {
          shiftId: morningShift.id,
          userId: users[email].id,
          date: today,
        },
      },
      update: {},
      create: {
        shiftId: morningShift.id,
        userId: users[email].id,
        date: today,
        status: ShiftStatus.ACTIVE,
      },
    });
  }

  const groundCp = checkpoints.filter((c) => c.qrCode.startsWith('CHKPT-G-')).slice(0, 6);
  const floor1Cp = checkpoints.filter((c) => c.qrCode.startsWith('CHKPT-F1-')).slice(0, 6);

  async function ensureRoute(name: string, description: string, cpList: typeof checkpoints, duration: number) {
    let route = await prisma.patrolRoute.findFirst({ where: { siteId: site.id, name } });
    if (!route) {
      route = await prisma.patrolRoute.create({
        data: { name, description, siteId: site.id, estimatedDuration: duration },
      });
      for (let i = 0; i < cpList.length; i++) {
        await prisma.patrolRouteCheckpoint.create({
          data: { routeId: route.id, checkpointId: cpList[i].id, sortOrder: i + 1 },
        });
      }
    }
    return route;
  }

  const groundRoute = await ensureRoute('Ground Floor Route', 'Lobby, parking, reception perimeter', groundCp, 45);
  const floor1Route = await ensureRoute('Floor 1 Perimeter', 'East/west wings and server room', floor1Cp, 50);

  const scheduledToday = new Date();
  scheduledToday.setHours(7, 0, 0, 0);

  const guard1 = users['guard1@securops.com'];
  const guard2 = users['guard2@securops.com'];
  const guard3 = users['guard3@securops.com'];
  const guard4 = users['guard4@securops.com'];

  // Completed patrol (guard1)
  let session1 = await prisma.patrolSession.findFirst({
    where: { guardId: guard1.id, routeId: groundRoute.id, scheduledAt: { gte: today } },
  });
  if (!session1) {
    session1 = await prisma.patrolSession.create({
      data: {
        routeId: groundRoute.id,
        guardId: guard1.id,
        scheduledAt: scheduledToday,
        startedAt: new Date(scheduledToday.getTime() + 15 * 60000),
        completedAt: new Date(scheduledToday.getTime() + 55 * 60000),
        status: PatrolStatus.COMPLETED,
        completionPct: 100,
      },
    });
    for (const cp of groundCp) {
      await prisma.patrolScan.create({
        data: {
          sessionId: session1.id,
          checkpointId: cp.id,
          guardId: guard1.id,
          scannedAt: new Date(scheduledToday.getTime() + 20 * 60000),
        },
      });
    }
  }

  // In-progress patrol (guard2) — 4/6 scans
  let session2 = await prisma.patrolSession.findFirst({
    where: { guardId: guard2.id, routeId: floor1Route.id, scheduledAt: { gte: today } },
  });
  if (!session2) {
    session2 = await prisma.patrolSession.create({
      data: {
        routeId: floor1Route.id,
        guardId: guard2.id,
        scheduledAt: new Date(scheduledToday.getTime() + 30 * 60000),
        startedAt: new Date(scheduledToday.getTime() + 35 * 60000),
        status: PatrolStatus.IN_PROGRESS,
        completionPct: Math.round((4 / floor1Cp.length) * 100),
      },
    });
    for (let i = 0; i < 4; i++) {
      await prisma.patrolScan.create({
        data: {
          sessionId: session2.id,
          checkpointId: floor1Cp[i].id,
          guardId: guard2.id,
        },
      });
    }
  }

  // Pending patrol (guard3)
  const pendingAt = new Date(scheduledToday.getTime() + 2 * 3600000);
  if (!(await prisma.patrolSession.findFirst({ where: { guardId: guard3.id, scheduledAt: pendingAt } }))) {
    await prisma.patrolSession.create({
      data: {
        routeId: groundRoute.id,
        guardId: guard3.id,
        scheduledAt: pendingAt,
        status: PatrolStatus.PENDING,
        completionPct: 0,
      },
    });
  }

  // Missed patrol yesterday (guard4)
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const missedAt = new Date(yesterday);
  missedAt.setHours(8, 0, 0, 0);
  if (!(await prisma.patrolSession.findFirst({ where: { guardId: guard4.id, scheduledAt: missedAt } }))) {
    await prisma.patrolSession.create({
      data: {
        routeId: floor1Route.id,
        guardId: guard4.id,
        scheduledAt: missedAt,
        status: PatrolStatus.MISSED,
        completionPct: 0,
      },
    });
  }

  // Attendance — guards clocked in today
  for (const email of ['guard1@securops.com', 'guard2@securops.com', 'guard3@securops.com', 'guard4@securops.com', 'supervisor@securops.com']) {
    const user = users[email];
    if (!user) continue;

    const clockIn = new Date(today);
    clockIn.setHours(6, Math.floor(Math.random() * 10), 0, 0);
    const existingAttendance = await prisma.attendance.findFirst({
      where: { userId: user.id, date: today },
    });
    if (!existingAttendance) {
      await prisma.attendance.create({
        data: {
          userId: user.id,
          date: today,
          clockIn,
          status: AttendanceStatus.CLOCKED_IN,
        },
      });
    }
  }

  // Sample incidents
  const eastZone = allZones.find((z) => z.code === 'F1-EAST')!;
  if (!(await prisma.incident.findFirst({ where: { title: 'Unauthorized access attempt' } }))) {
    await prisma.incident.create({
      data: {
        title: 'Unauthorized access attempt',
        description: 'Unknown individual attempted badge-protected door access.',
        severity: IncidentSeverity.HIGH,
        status: IncidentStatus.IN_PROGRESS,
        siteId: site.id,
        floorId: eastZone.floorId,
        zoneId: eastZone.id,
        reportedBy: users['guard2@securops.com'].id,
        assignedTo: users['supervisor@securops.com'].id,
      },
    });
  }

  if (!(await prisma.incident.findFirst({ where: { title: 'CCTV malfunction - Camera 7' } }))) {
    await prisma.incident.create({
      data: {
        title: 'CCTV malfunction - Camera 7',
        description: 'Parking entrance camera offline.',
        severity: IncidentSeverity.MEDIUM,
        status: IncidentStatus.OPEN,
        siteId: site.id,
        reportedBy: users['guard1@securops.com'].id,
      },
    });
  }

  console.log('✅ Seed complete');
  console.log(`   Company: ${company.name}`);
  console.log(`   Site: ${site.name}`);
  console.log(`   Floors: ${floors.length} | Zones: ${allZones.length} | Checkpoints: ${checkpoints.length}`);
  console.log(`   Users: ${userDefs.length} | Patrol routes: 2`);
  console.log('\nLogin: admin@securops.com / SecurOps2024!\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
