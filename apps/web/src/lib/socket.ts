import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { API_BASE } from './api';

/** Read-only diner socket: joins the location floor room for live 86 updates. */
export function connectGuest(locationId: string): Socket {
  return io(API_BASE, { auth: { locationId, rooms: ['floor'] } });
}
