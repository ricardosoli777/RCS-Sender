import pino from 'pino';

export function createLogger(component: string) {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { component },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.token',
        '*.apiKey',
        '*.secret',
        '*.credentials'
      ],
      censor: '[REDACTED]'
    }
  });
}
