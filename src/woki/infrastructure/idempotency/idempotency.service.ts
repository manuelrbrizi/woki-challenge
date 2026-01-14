import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { Booking } from '../../domain/entities/booking.entity';
import { Idempotency } from '../../domain/entities/idempotency.entity';
import { createHash } from 'crypto';
import { IdempotencyRepository as IIdempotencyRepository } from '../../ports/repositories/idempotency.repository.interface';
import { IDEMPOTENCY_REPOSITORY } from '../../tokens';

@Injectable()
export class IdempotencyService {
  private readonly TTL_MS = 60 * 1000; // 60 seconds

  constructor(
    @Inject(IDEMPOTENCY_REPOSITORY)
    private readonly repository: IIdempotencyRepository,
  ) {}

  /**
   * Check if an idempotency key exists and return the cached booking.
   */
  async get(key: string, payload: unknown): Promise<Booking | null> {
    const entry = await this.repository.findById(key);
    if (!entry) {
      return null;
    }

    // Check if expired
    if (entry.expiresAt < new Date()) {
      await this.repository.deleteExpired();
      return null;
    }

    // Verify payload matches (using hash)
    const payloadHash = this.hashPayload(payload);

    // If payloads don't match, the idempotency key is being reused with different data
    if (payloadHash !== entry.payloadHash) {
      // Idempotency key exists but payload doesn't match - this is an error
      throw new BadRequestException({
        error: 'invalid_input',
        detail: 'Idempotency key already used with different payload',
      });
    }

    return entry.booking;
  }

  /**
   * Store an idempotency key with the booking.
   */
  async set(key: string, booking: Booking, payload: unknown): Promise<void> {
    const expiresAt = new Date(Date.now() + this.TTL_MS);
    const payloadHash = this.hashPayload(payload);

    const idempotency = new Idempotency();
    idempotency.id = key;
    idempotency.bookingId = booking.id;
    idempotency.payloadHash = payloadHash;
    idempotency.expiresAt = expiresAt;
    idempotency.booking = booking;

    await this.repository.create(idempotency);

    // Clean up expired entries periodically (async, don't wait)
    this.repository.deleteExpired().catch(() => {
      // Ignore cleanup errors
    });
  }

  private hashPayload(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  /**
   * Clear all idempotency entries (useful for testing)
   */
  async clear(): Promise<void> {
    await this.repository.deleteAll();
  }
}
