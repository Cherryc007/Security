import express from 'express';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';

dotenv.config();

import { config } from './config';
import { errorHandler, notFound } from './middleware/errorHandler';
import { setupSocketIO, SocketEmitter } from './socket';

// Routes
import authRoutes from './routes/auth.routes';
import siteRoutes from './routes/site.routes';
import patrolRoutes from './routes/patrol.routes';
import incidentRoutes from './routes/incident.routes';
import attendanceRoutes from './routes/attendance.routes';
import userRoutes from './routes/user.routes';

const app = express();
const httpServer = createServer(app);

// Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: config.socket.corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

setupSocketIO(io);
SocketEmitter.init(io);

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use('/api/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/manage', siteRoutes);
app.use('/api/patrols', patrolRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/users', userRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Start
httpServer.listen(config.port, () => {
  console.log(`\n  ⚡ SecurOps Backend running on port ${config.port}`);
  console.log(`  📡 WebSocket ready`);
  console.log(`  🔒 Environment: ${config.nodeEnv}\n`);
});

export { io, app };
