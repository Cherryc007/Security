import { Router, Request, Response } from 'express';
import { authenticate, authorizeMinRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { z } from 'zod';
import { UserService } from '../services/user.service';
import prisma from '../config/database';

const router = Router();
router.use(authenticate);
router.use(authorizeMinRole('ADMIN'));

router.post('/', validate(z.object({
  email: z.string().email(),
  password: z.string().min(8).optional(),
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'COMMAND_OPS', 'SUPERVISOR', 'GUARD']),
  siteId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  employeeId: z.string().optional(),
  phone: z.string().optional(),
})), async (req: Request, res: Response) => {
  try {
    const user = await UserService.createUser(
      req.user!.companyId,
      req.user!.role,
      req.body
    );
    res.status(201).json(user);
  } catch (err: any) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const { role, siteId, search } = req.query;
    const where: any = { companyId: req.user!.companyId };
    if (role) where.role = role;
    if (siteId) where.siteId = siteId;
    if (search) {
      where.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
        { employeeId: { contains: search as string, mode: 'insensitive' } },
      ];
    }
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, employeeId: true, email: true, firstName: true, lastName: true,
        phone: true, role: true, isActive: true, siteId: true, createdAt: true,
        site: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { role, siteId, isActive, firstName, lastName, phone } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id as string },
      data: { role, siteId, isActive, firstName, lastName, phone },
      select: { id: true, employeeId: true, email: true, firstName: true, lastName: true, role: true, isActive: true, siteId: true },
    });
    res.json(user);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.user.update({ where: { id: req.params.id as string }, data: { isActive: false } });
    res.json({ message: 'User deactivated' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
