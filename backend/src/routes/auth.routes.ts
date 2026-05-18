import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from '../services/auth.service';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'COMMAND_OPS', 'SUPERVISOR', 'GUARD']),
  companyId: z.string().uuid(),
  siteId: z.string().uuid().optional(),
});

router.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const result = await AuthService.login(req.body.email, req.body.password);
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/register', authenticate, validate(registerSchema), async (req: Request, res: Response) => {
  try {
    const user = await AuthService.register(req.body);
    res.status(201).json(user);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) { res.status(400).json({ error: 'Refresh token required' }); return; }
    const tokens = await AuthService.refreshToken(refreshToken);
    res.json(tokens);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/logout', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) await AuthService.logout(refreshToken);
    res.json({ message: 'Logged out' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const { default: prisma } = await import('../config/database');
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true, employeeId: true, email: true, firstName: true, lastName: true,
        phone: true, avatar: true, role: true, companyId: true, siteId: true,
        company: { select: { id: true, name: true, code: true } },
        site: { select: { id: true, name: true, code: true } },
        shiftAssignments: {
          include: { shift: true },
          orderBy: { date: 'desc' },
          take: 5
        }
      },
    });

    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    let supervisor = null;
    if (user.role === 'GUARD' && user.siteId) {
      supervisor = await prisma.user.findFirst({
        where: { siteId: user.siteId, role: 'SUPERVISOR', isActive: true },
        select: { firstName: true, lastName: true, email: true, phone: true }
      });
    }

    res.json({ ...user, supervisor });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
