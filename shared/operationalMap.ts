export type ZoneStatus = 'SECURE' | 'ATTENTION' | 'ALERT' | 'OFFLINE';

export interface MapCheckpoint {
  id: string;
  name: string;
  qrCode: string;
  mapX: number | null;
  mapY: number | null;
  sortOrder: number;
  lastScannedAt?: string | null;
}

export interface ActiveGuardMarker {
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
}

export interface MapOverlay {
  type: 'INCIDENT' | 'SOS' | 'PATROL_DELAYED';
  zoneId?: string;
  label: string;
  severity?: string;
}

export interface MapZone {
  id: string;
  name: string;
  code: string;
  status: ZoneStatus;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  checkpoints: MapCheckpoint[];
}

export interface OperationalMapPayload {
  site: { id: string; name: string; code: string };
  floor: {
    id: string;
    name: string;
    number: number;
    mapViewBox: string;
    layoutSvg: string | null;
    layoutImageUrl: string | null;
    layoutWidth: number | null;
    layoutHeight: number | null;
  };
  zones: MapZone[];
  activeGuards: ActiveGuardMarker[];
  overlays: MapOverlay[];
}
