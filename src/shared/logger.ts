import pino from 'pino';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport:
    process.env['NODE_ENV'] !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  redact: {
    paths: ['api_key', 'apiKey', 'password', 'smtp_pass', 'secret', '*.api_key', '*.password'],
    censor: '***REDACTED***',
  },
});
