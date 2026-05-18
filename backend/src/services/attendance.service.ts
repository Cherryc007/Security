import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AttendanceStatus } from '@prisma/client';

export class AttendanceService {
  static async clockIn(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Block only simultaneous active clock-ins
    const activeSession = await prisma.attendance.findFirst({
      where: { userId, status: AttendanceStatus.CLOCKED_IN },
    });

    if (activeSession) {
      throw new AppError('Already clocked in. You must clock out of your current session before starting a new one.', 400);
    }

    return prisma.attendance.create({
      data: {
        userId,
        date: today,
        clockIn: new Date(),
        status: AttendanceStatus.CLOCKED_IN,
      },
    });
  }

  static async clockOut(userId: string) {
    // Find the latest active clock-in session
    const activeSession = await prisma.attendance.findFirst({
      where: { userId, status: AttendanceStatus.CLOCKED_IN },
      orderBy: { createdAt: 'desc' },
    });

    if (!activeSession || !activeSession.clockIn) {
      throw new AppError('No active clock-in session found.', 400);
    }

    const clockOut = new Date();
    const totalHours = (clockOut.getTime() - activeSession.clockIn.getTime()) / (1000 * 60 * 60);

    return prisma.attendance.update({
      where: { id: activeSession.id },
      data: {
        clockOut,
        totalHours: Math.round(totalHours * 100) / 100,
        status: AttendanceStatus.CLOCKED_OUT,
      },
    });
  }

  static async getForSite(siteId: string, date?: Date) {
    const targetDate = date || new Date();
    targetDate.setHours(0, 0, 0, 0);

    const users = await prisma.user.findMany({
      where: { siteId, isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeId: true,
        role: true,
        attendance: {
          where: { date: targetDate },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return users.map(u => ({
      ...u,
      attendance: u.attendance[0] || null,
    }));
  }

  static async getForUser(userId: string, startDate: Date, endDate: Date) {
    return prisma.attendance.findMany({
      where: {
        userId,
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: 'desc' },
    });
  }

  static async getSiteOverview(siteId: string, date?: Date) {
    const targetDate = date || new Date();
    targetDate.setHours(0, 0, 0, 0);

    const totalGuards = await prisma.user.count({
      where: { siteId, isActive: true, role: 'GUARD' },
    });

    const attendance = await prisma.attendance.findMany({
      where: {
        user: { siteId },
        date: targetDate,
      },
    });

    const clockedIn = attendance.filter(a => a.status === AttendanceStatus.CLOCKED_IN).length;
    const clockedOut = attendance.filter(a => a.status === AttendanceStatus.CLOCKED_OUT).length;
    const absent = totalGuards - attendance.length;

    return { totalGuards, clockedIn, clockedOut, absent, date: targetDate };
  }
}
