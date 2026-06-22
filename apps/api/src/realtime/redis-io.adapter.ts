import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.io Redis adapter so events fan out correctly once the API runs more than
 * one instance. Wired in main.ts only when REDIS_URL is set, so the app still
 * boots without Redis in single-instance dev.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor!: ReturnType<typeof createAdapter>;

  connectToRedis(url: string): Promise<void> {
    const pubClient = new Redis(url);
    const subClient = pubClient.duplicate();
    this.adapterConstructor = createAdapter(pubClient, subClient);
    return Promise.resolve();
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as Server;
    server.adapter(this.adapterConstructor);
    return server;
  }
}
