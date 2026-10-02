import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { createApp } from './app.js';

function dependencies(dbAvailable: boolean, redisAvailable: boolean) {
  const db = { query: async () => {
    if (!dbAvailable) throw new Error('database unavailable');
    return { rows: [{ '?column?': 1 }] };
  } } as unknown as Pool;
  const redis = { defineCommand: () => undefined, ping: async () => {
    if (!redisAvailable) throw new Error('redis unavailable');
    return 'PONG';
  } } as unknown as Redis;
  return { db, redis };
}

describe('health', () => {
  it('reports readiness only while both dependencies respond', async () => {
    const ready = createApp(dependencies(true, true), { appUrl: 'http://localhost:3000', secureCookies: false });
    const response = await ready.inject('/health/ready');
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    await ready.close();

    const unavailable = createApp(dependencies(true, false), { appUrl: 'http://localhost:3000', secureCookies: false });
    expect((await unavailable.inject('/health/ready')).statusCode).toBe(503);
    await unavailable.close();
  });
});
