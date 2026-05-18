import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { Role } from '@prisma/client';
import bcrypt from 'bcrypt';

export class UserService {
  static async createUser(adminCompanyId: string, adminRole: string, data: {
    email: string;
    password?: string; // If not provided, default or auto-generate
    firstName: string;
    lastName: string;
    role: Role;
    siteId?: string;
    employeeId?: string;
    phone?: string;
    companyId?: string; // For Super Admins creating cross-company
  }) {
    // 1. Role validation
    if (adminRole === 'ADMIN' && ['SUPER_ADMIN', 'ADMIN'].includes(data.role)) {
      throw new AppError('Admins cannot create other Admins or Super Admins', 403);
    }

    // 2. Determine company context
    const companyId = adminRole === 'SUPER_ADMIN' ? (data.companyId || adminCompanyId) : adminCompanyId;

    // 3. Check for existing user
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new AppError('Email already in use', 400);

    // 4. Hash password (default to 'Welcome123!' if not provided)
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(data.password || 'Welcome123!', salt);

    // 5. Create user
    return prisma.user.create({
      data: {
        email: data.email,
        passwordHash: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        siteId: data.siteId,
        companyId,
        employeeId: data.employeeId || `SEC-${Date.now().toString(36).toUpperCase()}`,
        phone: data.phone,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        employeeId: true,
        site: { select: { name: true } },
        isActive: true,
      }
    });
  }

  static async getUsers(companyId: string, role?: Role) {
    const where: any = { companyId };
    if (role) where.role = role;

    return prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        employeeId: true,
        phone: true,
        isActive: true,
        site: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  static async updateUserStatus(userId: string, isActive: boolean, adminCompanyId: string, adminRole: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);

    if (adminRole !== 'SUPER_ADMIN' && user.companyId !== adminCompanyId) {
      throw new AppError('Unauthorized to modify this user', 403);
    }
    if (user.role === 'SUPER_ADMIN') {
      throw new AppError('Cannot modify Super Admin status', 403);
    }

    return prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: { id: true, isActive: true }
    });
  }
}
