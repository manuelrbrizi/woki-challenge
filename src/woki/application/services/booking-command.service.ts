import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { parseISO } from 'date-fns';
import { randomUUID } from 'crypto';
import { RestaurantRepository as IRestaurantRepository } from '../../ports/repositories/restaurant.repository.interface';
import { SectorRepository as ISectorRepository } from '../../ports/repositories/sector.repository.interface';
import { TableRepository as ITableRepository } from '../../ports/repositories/table.repository.interface';
import { BookingRepository as IBookingRepository } from '../../ports/repositories/booking.repository.interface';
import { ServiceWindowRepository as IServiceWindowRepository } from '../../ports/repositories/service-window.repository.interface';
import {
  RESTAURANT_REPOSITORY,
  SECTOR_REPOSITORY,
  TABLE_REPOSITORY,
  BOOKING_REPOSITORY,
  SERVICE_WINDOW_REPOSITORY,
} from '../../tokens';
import { WokiBrainSelectorService } from '../../domain/services/wokibrain-selector.service';
import { LockManagerService } from '../../infrastructure/locking/lock-manager.service';
import { IdempotencyService } from '../../infrastructure/idempotency/idempotency.service';
import { Booking } from '../../domain/entities/booking.entity';
import { BookingStatus } from '../../domain/types/booking-status.enum';
import { ComboCandidate } from '../../domain/types/combo-candidate.type';
import {
  CreateBookingRequest,
  CreateBookingResponse,
} from '../dto/create-booking.dto';
import { BookingQueryService } from './booking-query.service';
import { validateWindowWithinServiceHours } from '../utils/window-validation.util';

@Injectable()
export class BookingCommandService {
  constructor(
    @Inject(RESTAURANT_REPOSITORY)
    private readonly restaurantRepository: IRestaurantRepository,
    @Inject(SECTOR_REPOSITORY)
    private readonly sectorRepository: ISectorRepository,
    @Inject(TABLE_REPOSITORY)
    private readonly tableRepository: ITableRepository,
    @Inject(BOOKING_REPOSITORY)
    private readonly bookingRepository: IBookingRepository,
    @Inject(SERVICE_WINDOW_REPOSITORY)
    private readonly serviceWindowRepository: IServiceWindowRepository,
    private readonly wokiBrainSelectorService: WokiBrainSelectorService,
    private readonly lockManagerService: LockManagerService,
    private readonly idempotencyService: IdempotencyService,
    private readonly bookingQueryService: BookingQueryService,
  ) {}

  async createBooking(
    request: CreateBookingRequest,
    idempotencyKey?: string,
  ): Promise<CreateBookingResponse> {
    // Validate duration is multiple of 15
    if (request.durationMinutes % 15 !== 0) {
      throw new BadRequestException(
        'Duration must be a multiple of 15 minutes',
      );
    }

    // Validate duration range
    if (request.durationMinutes < 30 || request.durationMinutes > 180) {
      throw new BadRequestException(
        'Duration must be between 30 and 180 minutes',
      );
    }

    // Check idempotency
    if (idempotencyKey) {
      const cached = this.idempotencyService.get(idempotencyKey, request);
      if (cached) {
        return this.toResponse(cached);
      }
    }

    // Parse date
    const date = parseISO(request.date);
    if (isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    // Get restaurant
    const restaurant = await this.restaurantRepository.findById(
      request.restaurantId,
    );
    if (!restaurant) {
      throw new NotFoundException({
        error: 'not_found',
        detail: 'Restaurant not found',
      });
    }

    // Get sector
    const sector = await this.sectorRepository.findById(request.sectorId);
    if (!sector) {
      throw new NotFoundException({
        error: 'not_found',
        detail: 'Sector not found',
      });
    }

    if (sector.restaurantId !== restaurant.id) {
      throw new NotFoundException({
        error: 'not_found',
        detail: 'Sector not found in restaurant',
      });
    }

    // Get all bookings for the date ONCE and reuse them
    // This ensures consistency between candidate selection and verification
    const bookings = await this.bookingRepository.findByDate(
      request.restaurantId,
      request.sectorId,
      date,
      restaurant.timezone,
    );

    // Find best candidate using query service
    const candidate = await this.findBestCandidate(
      request,
      restaurant,
      sector,
      date,
      bookings,
    );

    if (!candidate) {
      throw new ConflictException({
        error: 'no_capacity',
        detail: 'No single or combo gap fits duration within window',
      });
    }

    // Create lock key
    const lockKey = this.createLockKey(
      request.restaurantId,
      request.sectorId,
      candidate.tableIds,
      candidate.interval.start,
    );

    // Acquire lock (with timeout handling)
    let releaseLock: (() => void) | null = null;
    try {
      releaseLock = await this.lockManagerService.acquire(lockKey);
    } catch (error) {
      if (error instanceof Error && error.message === 'Lock timeout') {
        throw new ConflictException({
          error: 'table_locked',
          detail:
            'Table is currently being booked by another request. Please try again.',
        });
      }
      throw error;
    }

    try {
      // Re-verify capacity (double-check after acquiring lock)
      // Re-query ALL bookings for the date to check for any new bookings created between
      // candidate selection and lock acquisition. Use the same query method as initial query.
      const currentBookings = await this.bookingRepository.findByDate(
        request.restaurantId,
        request.sectorId,
        date,
        restaurant.timezone,
      );

      // Filter to only bookings that involve the candidate's tables
      const relevantBookings = currentBookings.filter(
        (b) =>
          b.status === BookingStatus.CONFIRMED &&
          b.tableIds.some((id) => candidate.tableIds.includes(id)),
      );

      const stillAvailable = this.verifyCapacityStillAvailable(
        candidate,
        relevantBookings,
      );

      if (!stillAvailable) {
        throw new ConflictException({
          error: 'no_capacity',
          detail: 'Capacity no longer available',
        });
      }

      // Create booking
      const booking = new Booking();
      booking.id = `BK_${randomUUID().substring(0, 8).toUpperCase()}`;
      booking.restaurantId = request.restaurantId;
      booking.sectorId = request.sectorId;
      booking.tableIds = candidate.tableIds;
      booking.partySize = request.partySize;
      booking.start = candidate.interval.start;
      booking.end = candidate.interval.end;
      booking.durationMinutes = request.durationMinutes;
      booking.status = BookingStatus.CONFIRMED;
      booking.createdAt = new Date();
      booking.updatedAt = new Date();

      const savedBooking = await this.bookingRepository.create(booking);

      // Store idempotency key
      if (idempotencyKey) {
        this.idempotencyService.set(idempotencyKey, savedBooking, request);
      }

      return this.toResponse(savedBooking);
    } finally {
      if (releaseLock) {
        releaseLock();
      }
    }
  }

  private async findBestCandidate(
    request: CreateBookingRequest,
    restaurant: { timezone: string },
    sector: { id: string },
    date: Date,
    bookings: Booking[],
  ): Promise<ComboCandidate | null> {
    // Get all tables in sector
    const tables = await this.tableRepository.findBySectorId(sector.id);

    // Get service windows for the restaurant
    const serviceWindows =
      await this.serviceWindowRepository.findByRestaurantId(
        request.restaurantId,
      );

    // Validate windowStart/windowEnd is within service windows (if provided)
    if (request.windowStart && request.windowEnd) {
      validateWindowWithinServiceHours(
        request.windowStart,
        request.windowEnd,
        serviceWindows,
      );
    }

    // Use query service to find all candidates
    const candidates = this.bookingQueryService.findCandidates(
      tables,
      bookings,
      date,
      request.durationMinutes,
      request.partySize,
      restaurant,
      serviceWindows.map((w) => ({ start: w.start, end: w.end })),
      request.windowStart,
      request.windowEnd,
    );

    // Select best candidate using WokiBrain selector
    return this.wokiBrainSelectorService.selectBestCandidate(candidates);
  }

  private verifyCapacityStillAvailable(
    candidate: ComboCandidate,
    bookings: Booking[],
  ): boolean {
    // Filter bookings that involve any of the candidate's tables
    const relevantBookings = bookings.filter(
      (b) =>
        b.status === BookingStatus.CONFIRMED &&
        b.tableIds.some((id) => candidate.tableIds.includes(id)),
    );

    // Check if candidate interval still has no conflicts
    const conflicts = relevantBookings.filter((b) =>
      this.intervalsOverlap(
        candidate.interval.start,
        candidate.interval.end,
        b.start,
        b.end,
      ),
    );

    return conflicts.length === 0;
  }

  private intervalsOverlap(
    start1: Date,
    end1: Date,
    start2: Date,
    end2: Date,
  ): boolean {
    return start1 < end2 && end1 > start2;
  }

  private createLockKey(
    restaurantId: string,
    sectorId: string,
    tableIds: string[],
    start: Date,
  ): string {
    const sortedTableIds = [...tableIds].sort().join('+');
    const startStr = start.toISOString();
    return `${restaurantId}|${sectorId}|${sortedTableIds}|${startStr}`;
  }

  private toResponse(booking: Booking): CreateBookingResponse {
    return {
      id: booking.id,
      restaurantId: booking.restaurantId,
      sectorId: booking.sectorId,
      tableIds: booking.tableIds,
      partySize: booking.partySize,
      start: booking.start.toISOString(),
      end: booking.end.toISOString(),
      durationMinutes: booking.durationMinutes,
      status: booking.status,
      createdAt: booking.createdAt.toISOString(),
      updatedAt: booking.updatedAt.toISOString(),
    };
  }
}
