import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyService } from './idempotency.service';
import { Booking } from '../../domain/entities/booking.entity';
import { BookingStatus } from '../../domain/types/booking-status.enum';

describe('IdempotencyService', () => {
  let service: IdempotencyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IdempotencyService],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('idempotency flow', () => {
    it('should return null for non-existent key', () => {
      const result = service.get('non-existent-key', {});
      expect(result).toBeNull();
    });

    it('should store and retrieve booking with same idempotency key', () => {
      const idempotencyKey = 'test-key-123';
      const requestPayload = {
        restaurantId: 'R1',
        sectorId: 'S1',
        partySize: 4,
        date: '2025-01-15',
        durationMinutes: 90,
      };

      const booking = new Booking();
      booking.id = 'BK_TEST123';
      booking.restaurantId = 'R1';
      booking.sectorId = 'S1';
      booking.partySize = 4;
      booking.start = new Date('2025-01-15T19:00:00Z');
      booking.end = new Date('2025-01-15T20:30:00Z');
      booking.status = BookingStatus.CONFIRMED;
      booking.createdAt = new Date();
      booking.updatedAt = new Date();

      // First call - no cache
      const firstResult = service.get(idempotencyKey, requestPayload);
      expect(firstResult).toBeNull();

      // Store the booking
      service.set(idempotencyKey, booking, requestPayload);

      // Second call with same key - should return cached booking
      const secondResult = service.get(idempotencyKey, requestPayload);
      expect(secondResult).not.toBeNull();
      expect(secondResult?.id).toBe('BK_TEST123');
      expect(secondResult?.restaurantId).toBe('R1');
      expect(secondResult?.partySize).toBe(4);
    });

    it('should return same booking for multiple calls with same idempotency key', () => {
      const idempotencyKey = 'test-key-456';
      const requestPayload = {
        restaurantId: 'R1',
        sectorId: 'S1',
        partySize: 2,
      };

      const booking = new Booking();
      booking.id = 'BK_TEST456';
      booking.restaurantId = 'R1';
      booking.sectorId = 'S1';
      booking.partySize = 2;
      booking.status = BookingStatus.CONFIRMED;
      booking.createdAt = new Date();
      booking.updatedAt = new Date();

      service.set(idempotencyKey, booking, requestPayload);

      // Multiple calls should return the same booking
      const result1 = service.get(idempotencyKey, requestPayload);
      const result2 = service.get(idempotencyKey, requestPayload);
      const result3 = service.get(idempotencyKey, requestPayload);

      expect(result1?.id).toBe('BK_TEST456');
      expect(result2?.id).toBe('BK_TEST456');
      expect(result3?.id).toBe('BK_TEST456');
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    it('should return null for expired entries', () => {
      const idempotencyKey = 'test-key-expired';
      const requestPayload = {};

      const booking = new Booking();
      booking.id = 'BK_EXPIRED';
      booking.status = BookingStatus.CONFIRMED;
      booking.createdAt = new Date();
      booking.updatedAt = new Date();

      service.set(idempotencyKey, booking, requestPayload);

      // Immediately after setting, should return the booking
      const beforeExpiry = service.get(idempotencyKey, requestPayload);
      expect(beforeExpiry).not.toBeNull();

      // Wait for TTL to expire (60 seconds)
      // We'll manually expire it by manipulating the cache
      const cache = (service as any).cache;
      const entry = cache.get(idempotencyKey);
      if (entry) {
        entry.expiresAt = new Date(Date.now() - 1000); // Set to 1 second ago
      }

      // After expiry, should return null
      const afterExpiry = service.get(idempotencyKey, requestPayload);
      expect(afterExpiry).toBeNull();
    });

    it('should handle different idempotency keys independently', () => {
      const key1 = 'key-1';
      const key2 = 'key-2';
      const requestPayload = {};

      const booking1 = new Booking();
      booking1.id = 'BK_001';
      booking1.status = BookingStatus.CONFIRMED;
      booking1.createdAt = new Date();
      booking1.updatedAt = new Date();

      const booking2 = new Booking();
      booking2.id = 'BK_002';
      booking2.status = BookingStatus.CONFIRMED;
      booking2.createdAt = new Date();
      booking2.updatedAt = new Date();

      service.set(key1, booking1, requestPayload);
      service.set(key2, booking2, requestPayload);

      expect(service.get(key1, requestPayload)?.id).toBe('BK_001');
      expect(service.get(key2, requestPayload)?.id).toBe('BK_002');
    });
  });
});
