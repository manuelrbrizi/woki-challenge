import { Injectable } from '@nestjs/common';
import pino from 'pino';

@Injectable()
export class LoggerService {
  private logger: pino.Logger;

  constructor() {
    this.logger = pino({
      level: process.env.LOG_LEVEL || 'info',
      transport:
        process.env.NODE_ENV !== 'production'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
              },
            }
          : undefined,
    });
  }

  log(context: {
    requestId?: string;
    sectorId?: string;
    partySize?: number;
    duration?: number;
    op: string;
    durationMs?: number;
    outcome: string;
    [key: string]: unknown;
  }): void {
    this.logger.info(context);
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.logger.error({ err: error, ...context }, message);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.logger.warn(context, message);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.logger.debug(context, message);
  }
}

