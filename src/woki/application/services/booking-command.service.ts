import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { randomUUID } from 'crypto';
import { RestaurantRepository as IRestaurantRepository } from '../../ports/repositories/restaurant.repository.interface';
import { SectorRepository as ISectorRepository } from '../../ports/repositories/sector.repository.interface';
import { TableRepository as ITableRepository } from '../../ports/repositories/table.repository.interface';
import { BookingRepository as IBookingRepository } from '../../ports/repositories/booking.repository.interface';
import { BlackoutRepository as IBlackoutRepository } from '../../ports/repositories/blackout.repository.interface';
import { ServiceWindowRepository as IServiceWindowRepository } from '../../ports/repositories/service-window.repository.interface';
import {
  RESTAURANT_REPOSITORY,
  SECTOR_REPOSITORY,
  TABLE_REPOSITORY,
  BOOKING_REPOSITORY,
  BLACKOUT_REPOSITORY,
  SERVICE_WINDOW_REPOSITORY,
} from '../../tokens';
import { WokiBrainSelectorService } from '../../domain/services/wokibrain-selector.service';
import { LockManagerService } from '../../infrastructure/locking/lock-manager.service';
import { IdempotencyService } from '../../infrastructure/idempotency/idempotency.service';
import { MetricsService } from '../../infrastructure/metrics/metrics.service';
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
    @Inject(BLACKOUT_REPOSITORY)
    private readonly blackoutRepository: IBlackoutRepository,
    @Inject(SERVICE_WINDOW_REPOSITORY)
    private readonly serviceWindowRepository: IServiceWindowRepository,
    private readonly wokiBrainSelectorService: WokiBrainSelectorService,
    private readonly lockManagerService: LockManagerService,
    private readonly idempotencyService: IdempotencyService,
    private readonly bookingQueryService: BookingQueryService,
    private readonly metricsService: MetricsService,
  ) {}

  async createBooking(
    request: CreateBookingRequest,
    idempotencyKey: string,
  ): Promise<CreateBookingResponse> {
    // Validate duration is multiple of 15
    if (request.durationMinutes % 15 !== 0) {
      throw new BadRequestException({
        error: 'invalid_input',
        detail: 'Duration must be a multiple of 15 minutes',
      });
    }

    // Parse date
    const date = parseISO(request.date);
    if (isNaN(date.getTime())) {
      throw new BadRequestException({
        error: 'invalid_input',
        detail: 'Invalid date format',
      });
    }

    // Get restaurant first (needed for timezone in cached response)
    const restaurant = await this.restaurantRepository.findById(
      request.restaurantId,
    );
    if (!restaurant) {
      throw new NotFoundException({
        error: 'not_found',
        detail: 'Restaurant not found',
      });
    }

    // Check idempotency (key is now required, so always check)
    const cached = await this.idempotencyService.get(idempotencyKey, request);
    if (cached) {
      return this.toResponse(cached, restaurant.timezone);
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

    // Get all bookings and blackouts for the date ONCE and reuse them
    // This ensures consistency between candidate selection and verification
    const bookings = await this.bookingRepository.findByDate(
      request.restaurantId,
      request.sectorId,
      date,
      restaurant.timezone,
    );

    const blackouts = await this.blackoutRepository.findByDate(
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
      blackouts,
    );

    if (!candidate) {
      this.metricsService.recordConflict('no_capacity');
      throw new ConflictException({
        error: 'no_capacity',
        detail: 'No single or combo gap fits duration within window',
      });
    }

    // Start assignment time measurement (from candidate selection to booking creation)
    const assignmentStartTime = Date.now();

    // Acquire locks for all tables in the candidate (sorted to prevent deadlocks)
    const sortedTableIds = [...candidate.tableIds].sort();
    const acquiredLocks: Array<{ release: () => void; waitTimeMs: number }> =
      [];
    let maxWaitTimeMs = 0;

    try {
      // Acquire locks sequentially for each table
      for (const tableId of sortedTableIds) {
        const lockKey = this.createTableLockKey(
          request.restaurantId,
          request.sectorId,
          tableId,
          candidate.interval.start,
        );

        try {
          const lockResult = await this.lockManagerService.acquire(lockKey);
          acquiredLocks.push(lockResult);
          maxWaitTimeMs = Math.max(maxWaitTimeMs, lockResult.waitTimeMs);
        } catch (error) {
          // Release all previously acquired locks before throwing
          for (const lock of acquiredLocks) {
            lock.release();
          }
          acquiredLocks.length = 0;

          if (error instanceof Error && error.message === 'Lock timeout') {
            // For timeout cases, we can't get the exact wait time since the error
            // is thrown before returning. We record the timeout separately.
            this.metricsService.recordLockTimeout();
            this.metricsService.recordConflict('table_locked');
            throw new ConflictException({
              error: 'table_locked',
              detail:
                'Table is currently being booked by another request. Please try again.',
            });
          }
          throw error;
        }
      }

      // Record lock wait time (use max wait time as it represents the longest wait)
      if (maxWaitTimeMs > 0) {
        this.metricsService.recordLockWaitTime(maxWaitTimeMs);
      }
    } catch (error) {
      // Ensure all locks are released if we haven't already
      for (const lock of acquiredLocks) {
        lock.release();
      }
      throw error;
    }

    try {
      // Re-verify capacity (double-check after acquiring lock)
      // Re-query ALL bookings and blackouts for the date to check for any new bookings/blackouts created between
      // candidate selection and lock acquisition. Use the same query method as initial query.
      const currentBookings = await this.bookingRepository.findByDate(
        request.restaurantId,
        request.sectorId,
        date,
        restaurant.timezone,
      );

      const currentBlackouts = await this.blackoutRepository.findByDate(
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

      // Filter blackouts that affect the candidate's tables
      const relevantBlackouts = currentBlackouts.filter((bl) => {
        // Check if any candidate table is in the blackout's tableIds
        if (bl.tableIds.some((id) => candidate.tableIds.includes(id))) {
          return true;
        }
        // If blackout has empty tableIds and sectorId matches, it's a whole-sector blackout
        if (bl.sectorId === request.sectorId && bl.tableIds.length === 0) {
          return true;
        }
        return false;
      });

      const stillAvailable = this.verifyCapacityStillAvailable(
        candidate,
        relevantBookings,
        relevantBlackouts,
      );

      if (!stillAvailable) {
        this.metricsService.recordConflict('no_capacity');
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

      // Record assignment time (from candidate selection to booking creation)
      const assignmentTime = Date.now() - assignmentStartTime;
      this.metricsService.recordAssignmentTime(assignmentTime);

      // Record booking created
      this.metricsService.recordBookingCreated();

      // Store idempotency key (required, so always store)
      await this.idempotencyService.set(idempotencyKey, savedBooking, request);

      return this.toResponse(savedBooking, restaurant.timezone);
    } finally {
      // Release all acquired locks
      for (const lock of acquiredLocks) {
        lock.release();
      }
    }
  }

  private async findBestCandidate(
    request: CreateBookingRequest,
    restaurant: { timezone: string },
    sector: { id: string },
    date: Date,
    bookings: Booking[],
    blackouts: Array<{
      tableIds: string[];
      sectorId: string | null;
      start: Date;
      end: Date;
    }>,
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
      blackouts,
      sector.id,
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
    blackouts: Array<{ start: Date; end: Date }>,
  ): boolean {
    // Check if candidate interval conflicts with any bookings
    const bookingConflicts = bookings.filter((b) =>
      this.intervalsOverlap(
        candidate.interval.start,
        candidate.interval.end,
        b.start,
        b.end,
      ),
    );

    // Check if candidate interval conflicts with any blackouts
    const blackoutConflicts = blackouts.filter((bl) =>
      this.intervalsOverlap(
        candidate.interval.start,
        candidate.interval.end,
        bl.start,
        bl.end,
      ),
    );

    return bookingConflicts.length === 0 && blackoutConflicts.length === 0;
  }

  private intervalsOverlap(
    start1: Date,
    end1: Date,
    start2: Date,
    end2: Date,
  ): boolean {
    return start1 < end2 && end1 > start2;
  }

  /**
   * Create a lock key for a single table at a specific time.
   * Format: {restaurantId}|{sectorId}|{tableId}|{start}
   */
  private createTableLockKey(
    restaurantId: string,
    sectorId: string,
    tableId: string,
    start: Date,
  ): string {
    const startStr = start.toISOString();
    return `${restaurantId}|${sectorId}|${tableId}|${startStr}`;
  }

  async cancelBooking(id: string): Promise<void> {
    const booking = await this.bookingRepository.findById(id);
    if (!booking) {
      throw new NotFoundException({
        error: 'not_found',
        detail: 'Booking not found',
      });
    }

    // Nullify any idempotency records that reference this booking
    // This handles the foreign key constraint before deleting the booking
    await this.idempotencyService.nullifyBookingId(id);

    // Delete the booking
    await this.bookingRepository.delete(id);

    // Record cancellation in metrics
    this.metricsService.recordBookingCancelled();
  }

  private toResponse(
    booking: Booking,
    timezone: string,
  ): CreateBookingResponse {
    const formatDateInTimezone = (date: Date) =>
      formatInTimeZone(date, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX");

    return {
      id: booking.id,
      restaurantId: booking.restaurantId,
      sectorId: booking.sectorId,
      tableIds: booking.tableIds,
      partySize: booking.partySize,
      start: formatDateInTimezone(booking.start),
      end: formatDateInTimezone(booking.end),
      durationMinutes: booking.durationMinutes,
      status: booking.status,
      createdAt: formatDateInTimezone(booking.createdAt),
      updatedAt: formatDateInTimezone(booking.updatedAt),
    };
  }
}
