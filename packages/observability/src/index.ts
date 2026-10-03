import pino, { type DestinationStream } from 'pino';

export function createLogger(component: string, destination?: DestinationStream) {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { component },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
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
