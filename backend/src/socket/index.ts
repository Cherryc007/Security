import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthPayload } from '../middleware/auth';
import { SocketEvents } from '@shared/socketEvents';

interface AuthenticatedSocket extends Socket {
  user?: AuthPayload;
}

export function setupSocketIO(io: Server) {
  // Auth middleware for socket connections
  io.use((socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
    if (!token) return next(new Error('Authentication required'));

    try {
      const payload = jwt.verify(token, config.jwt.accessSecret) as AuthPayload;
      socket.user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    const user = socket.user!;
    console.log(`[WS] Connected: ${user.email} (${user.role})`);

    // Auto-join rooms based on role
    socket.join(`user:${user.userId}`);
    socket.join(`company:${user.companyId}`);

    if (user.siteId) {
      socket.join(`site:${user.siteId}`);
    }

    // Command center users join the command-center room
    if (['SUPER_ADMIN', 'ADMIN', 'COMMAND_OPS'].includes(user.role)) {
      socket.join('command-center');
    }

    // Join specific rooms
    socket.on('join:floor', (floorId: string) => {
      socket.join(`floor:${floorId}`);
    });

    socket.on('join:zone', (zoneId: string) => {
      socket.join(`zone:${zoneId}`);
    });

    socket.on('join:patrol', (sessionId: string) => {
      socket.join(`patrol:${sessionId}`);
    });

    socket.on('leave:floor', (floorId: string) => {
      socket.leave(`floor:${floorId}`);
    });

    socket.on('leave:zone', (zoneId: string) => {
      socket.leave(`zone:${zoneId}`);
    });

    socket.on('leave:patrol', (sessionId: string) => {
      socket.leave(`patrol:${sessionId}`);
    });

    // ═══════════════════════════════════════════════════
    // ON-DEMAND LOCATION TRACKING
    // ═══════════════════════════════════════════════════

    // 1. Authority requests location from a specific user
    socket.on('location:request', (data: { targetUserId: string, durationMinutes?: number }) => {
      if (['SUPER_ADMIN', 'ADMIN', 'COMMAND_OPS', 'SUPERVISOR'].includes(user.role)) {
        console.log(`[WS] ${user.role} requested location for ${data.targetUserId}`);
        // Tell the target user's app to start streaming GPS
        socket.to(`user:${data.targetUserId}`).emit(SocketEvents.LOCATION_START_STREAM, {
          requesterId: user.userId,
          durationMinutes: data.durationMinutes || 15
        });
        
        // The requester joins a temporary tracking room for this user
        socket.join(`tracking:${data.targetUserId}`);
      }
    });

    // 2. Mobile app sends live GPS updates back
    socket.on('location:update', (data: { latitude: number, longitude: number, accuracy: number }) => {
      // Broadcast this update ONLY to people in the tracking room for this user
      socket.to(`tracking:${user.userId}`).emit(SocketEvents.LOCATION_DATA, {
        userId: user.userId,
        ...data,
        timestamp: new Date().toISOString()
      });
    });

    // 3. Authority stops tracking
    socket.on('location:stop', (targetUserId: string) => {
      if (['SUPER_ADMIN', 'ADMIN', 'COMMAND_OPS', 'SUPERVISOR'].includes(user.role)) {
        // Tell the mobile app to stop streaming
        socket.to(`user:${targetUserId}`).emit(SocketEvents.LOCATION_STOP_STREAM);
        // Leave the tracking room
        socket.leave(`tracking:${targetUserId}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[WS] Disconnected: ${user.email}`);
    });
  });

  return io;
}

// Helper to emit events from services
export class SocketEmitter {
  private static io: Server;

  static init(io: Server) {
    this.io = io;
  }

  static emitToSite(siteId: string, event: string, data: any) {
    this.io?.to(`site:${siteId}`).emit(event, data);
  }

  static emitToFloor(floorId: string, event: string, data: any) {
    this.io?.to(`floor:${floorId}`).emit(event, data);
  }

  static emitToZone(zoneId: string, event: string, data: any) {
    this.io?.to(`zone:${zoneId}`).emit(event, data);
  }

  static emitToUser(userId: string, event: string, data: any) {
    this.io?.to(`user:${userId}`).emit(event, data);
  }

  static emitToCommandCenter(event: string, data: any) {
    this.io?.to('command-center').emit(event, data);
  }

  static emitToPatrol(sessionId: string, event: string, data: any) {
    this.io?.to(`patrol:${sessionId}`).emit(event, data);
  }

  static emitToCompany(companyId: string, event: string, data: any) {
    this.io?.to(`company:${companyId}`).emit(event, data);
  }

  // Force trigger location fetch (e.g., during SOS)
  static triggerEmergencyLocationFetch(userId: string) {
    this.io?.to(`user:${userId}`).emit(SocketEvents.LOCATION_START_STREAM, {
      requesterId: 'SYSTEM',
      durationMinutes: 60, // Stream for an hour during SOS
      isEmergency: true
    });
  }
}
