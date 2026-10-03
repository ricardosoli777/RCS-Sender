import pino, { type DestinationStream } from 'pino';

export function createLogger(component: string, destination?: DestinationStream) {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { component },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-rcs-edge-token"]',
        'req.headers["x-rcs-proxy-token"]',
        'res.headers["set-cookie"]',
        'password',
        'token',
        'apiKey',
        'secret',
        'credentials',
        '*.password',
        '*.token',
        '*.apiKey',
        '*.secret',
        '*.credentials'
      ],
      censor: '[REDACTED]'
    }
  }, destination);
}
