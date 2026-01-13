import { Injectable } from '@nestjs/common';
import { Booking } from '../../domain/entities/booking.entity';
import { createHash } from 'crypto';

interface IdempotencyEntry {
  booking: Booking;
  payloadHash: string;
  expiresAt: Date;
}

@Injectable()
export class IdempotencyService {
  private cache = new Map<string, IdempotencyEntry>();
  private readonly TTL_MS = 60 * 1000; // 60 seconds

  /**
   * Check if an idempotency key exists and return the cached booking.
   */
  get(key: string, payload: unknown): Booking | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Check if expired
    if (entry.expiresAt < new Date()) {
      this.cache.delete(key);
      return null;
    }

    // Verify payload matches (using hash)
    const payloadHash = this.hashPayload(payload);
    
    // If payloads don't match, the idempotency key is being reused with different data
    if (payloadHash !== entry.payloadHash) {
      // In production, you might want to throw an error or return null
      // For now, we'll return null to indicate the key doesn't match
      return null;
    }
    
    return entry.booking;
  }

  /**
   * Store an idempotency key with the booking.
   */
  set(key: string, booking: Booking, payload: unknown): void {
    const expiresAt = new Date(Date.now() + this.TTL_MS);
    const payloadHash = this.hashPayload(payload);
    this.cache.set(key, { booking, payloadHash, expiresAt });

    // Clean up expired entries periodically
    this.cleanup();
  }

  private hashPayload(payload: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  private cleanup(): void {
    const now = new Date();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }
}

