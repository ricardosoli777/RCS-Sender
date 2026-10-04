import pino, { type DestinationStream } from 'pino';

export function createLogger(component: string, destination?: DestinationStream) {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { component },
    serializers: { req: (request: {method?:string;url?:string;headers?:unknown;socket?:{remoteAddress?:string}}) => ({
      method:request.method,url:request.url?.replace(/\/provider-media\/[A-Za-z0-9_-]+/g,'/provider-media/[REDACTED]'),headers:request.headers,remoteAddress:request.socket?.remoteAddress
    }) },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-rcs-edge-token"]',
        'req.headers["x-rcs-proxy-token"]',
        'req.headers["x-rcs-webhook-token"]',
        'req.body',
        'rawBody',
        'ciphertext',
        'payload_ciphertext',
        'authToken',
        'apiToken',
        'keySecret',
        'privateKey',
        'webhookToken',
        'webhookSecret',
        '*.authToken',
        '*.apiToken',
        '*.keySecret',
        '*.privateKey',
        '*.webhookToken',
        '*.webhookSecret',
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
