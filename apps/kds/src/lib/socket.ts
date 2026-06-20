import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { API_BASE } from './api';

/** Staff socket joined to the location kitchen room. */
export function connectKitchen(staffId: string): Socket {
  return io(API_BASE, { auth: { staffId, rooms: ['kitchen'] } });
}
