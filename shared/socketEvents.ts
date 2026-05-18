/** Canonical Socket.IO event names — keep backend/web/mobile in sync */
export const SocketEvents = {
  PATROL_STARTED: 'patrol:started',
  PATROL_PROGRESS: 'patrol:progress',
  PATROL_SCANNED: 'patrol:scanned',
  GUARD_OPERATIONAL: 'guard:operational',
  INCIDENT_NEW: 'incident:new',
  INCIDENT_UPDATED: 'incident:updated',
  SOS_TRIGGERED: 'sos:triggered',
  SOS_RESOLVED: 'sos:resolved',
  LOCATION_START_STREAM: 'location:start_stream',
  LOCATION_STOP_STREAM: 'location:stop_stream',
  LOCATION_DATA: 'location:data',
  ATTENDANCE_UPDATE: 'attendance:update',
} as const;

export type SocketEventName = (typeof SocketEvents)[keyof typeof SocketEvents];
