import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyService } from './idempotency.service';
import { Booking } from '../../domain/entities/booking.entity';
import { BookingStatus } from '../../domain/types/booking-status.enum';
import { IdempotencyRepository } from '../../ports/repositories/idempotency.repository.interface';
import { IDEMPOTENCY_REPOSITORY } from '../../tokens';
import { Idempotency } from '../../domain/entities/idempotency.entity';
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let mockRepository: jest.Mocked<IdempotencyRepository>;

  beforeEach(async () => {
    const mockRepo = {
      findById: jest.fn(),
      create: jest.fn(),
      deleteExpired: jest.fn().mockResolvedValue(undefined),
      deleteAll: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        {
          provide: IDEMPOTENCY_REPOSITORY,
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
    mockRepository = module.get(IDEMPOTENCY_REPOSITORY);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const hashPayload = (payload: unknown): string => {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  };

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('idempotency flow', () => {
    it('should return null for non-existent key', async () => {
      mockRepository.findById.mockResolvedValue(null);

      const result = await service.get('non-existent-key', {});
      expect(result).toBeNull();
      expect(mockRepository.findById).toHaveBeenCalledWith('non-existent-key');
    });

    it('should store and retrieve booking with same idempotency key', async () => {
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
      mockRepository.findById.mockResolvedValue(null);
      const firstResult = await service.get(idempotencyKey, requestPayload);
      expect(firstResult).toBeNull();

      // Store the booking
      const payloadHash = hashPayload(requestPayload);
      const idempotency = new Idempotency();
      idempotency.id = idempotencyKey;
      idempotency.bookingId = booking.id;
      idempotency.booking = booking;
      idempotency.payloadHash = payloadHash;
      idempotency.expiresAt = new Date(Date.now() + 60000);
      mockRepository.create.mockResolvedValue(idempotency);
      await service.set(idempotencyKey, booking, requestPayload);
      expect(mockRepository.create).toHaveBeenCalled();

      // Second call with same key - should return cached booking
      const savedIdempotency = new Idempotency();
      savedIdempotency.id = idempotencyKey;
      savedIdempotency.bookingId = booking.id;
      savedIdempotency.booking = booking;
      savedIdempotency.payloadHash = payloadHash;
      savedIdempotency.expiresAt = new Date(Date.now() + 60000);
      mockRepository.findById.mockResolvedValue(savedIdempotency);

      const secondResult = await service.get(idempotencyKey, requestPayload);
      expect(secondResult).not.toBeNull();
      expect(secondResult?.id).toBe('BK_TEST123');
      expect(secondResult?.restaurantId).toBe('R1');
      expect(secondResult?.partySize).toBe(4);
    });

    it('should return same booking for multiple calls with same idempotency key', async () => {
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

      const payloadHash = hashPayload(requestPayload);
      const idempotency = new Idempotency();
      idempotency.id = idempotencyKey;
      idempotency.bookingId = booking.id;
      idempotency.booking = booking;
      idempotency.payloadHash = payloadHash;
      idempotency.expiresAt = new Date(Date.now() + 60000);
      mockRepository.create.mockResolvedValue(idempotency);
      await service.set(idempotencyKey, booking, requestPayload);

      // Multiple calls should return the same booking
      mockRepository.findById.mockResolvedValue(idempotency);
      const result1 = await service.get(idempotencyKey, requestPayload);
      const result2 = await service.get(idempotencyKey, requestPayload);
      const result3 = await service.get(idempotencyKey, requestPayload);

      expect(result1?.id).toBe('BK_TEST456');
      expect(result2?.id).toBe('BK_TEST456');
      expect(result3?.id).toBe('BK_TEST456');
    });

    it('should return null for expired entries', async () => {
      const idempotencyKey = 'test-key-expired';
      const requestPayload = {};

      const booking = new Booking();
      booking.id = 'BK_EXPIRED';
      booking.status = BookingStatus.CONFIRMED;
      booking.createdAt = new Date();
      booking.updatedAt = new Date();

      const payloadHash = hashPayload(requestPayload);
      const expiredIdempotency = new Idempotency();
      expiredIdempotency.id = idempotencyKey;
      expiredIdempotency.bookingId = booking.id;
      expiredIdempotency.booking = booking;
      expiredIdempotency.payloadHash = payloadHash;
      expiredIdempotency.expiresAt = new Date(Date.now() - 1000); // Expired

      // First call returns expired entry
      mockRepository.findById.mockResolvedValue(expiredIdempotency);
      mockRepository.deleteExpired.mockResolvedValue();

      const afterExpiry = await service.get(idempotencyKey, requestPayload);
      expect(afterExpiry).toBeNull();
      expect(mockRepository.deleteExpired).toHaveBeenCalled();
    });

    it('should throw error when payload hash does not match', async () => {
      const idempotencyKey = 'test-key-mismatch';
      const differentPayload = { restaurantId: 'R2' };

      const booking = new Booking();
      booking.id = 'BK_MISMATCH';
      booking.status = BookingStatus.CONFIRMED;

      const idempotency = new Idempotency();
      idempotency.id = idempotencyKey;
      idempotency.bookingId = booking.id;
      idempotency.booking = booking;
      // Set a different payload hash (simulating original payload)
      idempotency.payloadHash = 'original-hash';
      idempotency.expiresAt = new Date(Date.now() + 60000);

      mockRepository.findById.mockResolvedValue(idempotency);

      await expect(
        service.get(idempotencyKey, differentPayload),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle different idempotency keys independently', async () => {
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

      const payloadHash1 = hashPayload(requestPayload);
      const payloadHash2 = hashPayload(requestPayload);
      const idempotency1 = new Idempotency();
      idempotency1.id = key1;
      idempotency1.bookingId = booking1.id;
      idempotency1.booking = booking1;
      idempotency1.payloadHash = payloadHash1;
      idempotency1.expiresAt = new Date(Date.now() + 60000);

      const idempotency2 = new Idempotency();
      idempotency2.id = key2;
      idempotency2.bookingId = booking2.id;
      idempotency2.booking = booking2;
      idempotency2.payloadHash = payloadHash2;
      idempotency2.expiresAt = new Date(Date.now() + 60000);

      mockRepository.create.mockResolvedValue(idempotency1);
      await service.set(key1, booking1, requestPayload);
      mockRepository.create.mockResolvedValue(idempotency2);
      await service.set(key2, booking2, requestPayload);

      mockRepository.findById.mockImplementation((key: string) => {
        if (key === key1) return Promise.resolve(idempotency1);
        if (key === key2) return Promise.resolve(idempotency2);
        return Promise.resolve(null);
      });

      const result1 = await service.get(key1, requestPayload);
      const result2 = await service.get(key2, requestPayload);

      expect(result1?.id).toBe('BK_001');
      expect(result2?.id).toBe('BK_002');
    });

    it('should clear all entries', async () => {
      mockRepository.deleteAll.mockResolvedValue();
      await service.clear();
      expect(mockRepository.deleteAll).toHaveBeenCalled();
    });
  });
});
