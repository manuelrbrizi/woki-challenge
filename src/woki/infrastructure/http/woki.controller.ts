import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Body,
  Param,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BookingQueryService } from '../../application/services/booking-query.service';
import { BookingCommandService } from '../../application/services/booking-command.service';
import { BlackoutQueryService } from '../../application/services/blackout-query.service';
import { BlackoutCommandService } from '../../application/services/blackout-command.service';
import {
  DiscoverSeatsQuerySchema,
  DiscoverSeatsQuery,
} from '../../application/dto/discover-seats.dto';
import {
  CreateBookingSchema,
  CreateBookingRequest,
} from '../../application/dto/create-booking.dto';
import {
  ListBookingsQuerySchema,
  ListBookingsQuery,
} from '../../application/dto/list-bookings.dto';
import {
  CreateBlackoutSchema,
  CreateBlackoutRequest,
} from '../../application/dto/create-blackout.dto';
import {
  ListBlackoutsQuerySchema,
  ListBlackoutsQuery,
} from '../../application/dto/list-blackouts.dto';
import { BookingRepository as IBookingRepository } from '../../ports/repositories/booking.repository.interface';
import { LoggerService } from '../logging/logger.service';
import { MetricsService } from '../metrics/metrics.service';
import { randomUUID } from 'crypto';
import { Inject } from '@nestjs/common';
import { BOOKING_REPOSITORY } from '../../tokens';

// Helper function to get throttle limits based on environment.
// By default, tests run with much higher limits to avoid rate limiting unrelated e2e suites.
// Set ENABLE_RATE_LIMITING=true to force production-like limits (used by rate limiting e2e tests).
const getThrottleConfig = (defaultLimit: number) => {
  const isTest = process.env.NODE_ENV === 'test';
  const relaxInTests = isTest && process.env.ENABLE_RATE_LIMITING !== 'true';
  return {
    default: {
      limit: relaxInTests ? 10000 : defaultLimit,
      ttl: 60000,
    },
  };
};

@ApiTags('woki')
@Controller('woki')
export class WokiController {
  constructor(
    private readonly bookingQueryService: BookingQueryService,
    private readonly bookingCommandService: BookingCommandService,
    private readonly blackoutQueryService: BlackoutQueryService,
    private readonly blackoutCommandService: BlackoutCommandService,
    @Inject(BOOKING_REPOSITORY)
    private readonly bookingRepository: IBookingRepository,
    private readonly logger: LoggerService,
    private readonly metricsService: MetricsService,
  ) {}

  @Get('discover')
  @Throttle(getThrottleConfig(100))
  @ApiOperation({ summary: 'Discover available seats' })
  @ApiResponse({ status: 200, description: 'Candidates found' })
  @ApiResponse({ status: 404, description: 'Restaurant or sector not found' })
  @ApiResponse({ status: 409, description: 'No capacity' })
  @ApiResponse({ status: 422, description: 'Outside service window' })
  async discover(@Query() query: DiscoverSeatsQuery) {
    const requestId = randomUUID();
    const startTime = Date.now();

    try {
      // Validate query
      const validated = DiscoverSeatsQuerySchema.parse(query);

      this.logger.log({
        requestId,
        sectorId: validated.sectorId,
        partySize: validated.partySize,
        duration: validated.duration,
        op: 'discover',
        outcome: 'success',
      });

      const result = await this.bookingQueryService.discoverSeats(validated);

      this.logger.log({
        requestId,
        durationMs: Date.now() - startTime,
        outcome: 'success',
        op: 'discover',
      });

      if (result.candidates.length === 0) {
        throw new ConflictException({
          error: 'no_capacity',
          detail: 'No single or combo gap fits duration within window',
        });
      }

      return result;
    } catch (error: any) {
      this.logger.error('Discover seats failed', error, {
        requestId,
        durationMs: Date.now() - startTime,
        outcome: 'error',
      });

      if (error instanceof ConflictException) {
        throw error;
      }

      if (error instanceof NotFoundException) {
        throw error;
      }

      if (error instanceof UnprocessableEntityException) {
        throw error;
      }

      if (error.name === 'ZodError') {
        throw new BadRequestException({
          error: 'invalid_input',
          detail: error.errors,
        });
      }

      throw new BadRequestException({
        error: 'invalid_input',
        detail: error.message,
      });
    }
  }

  @Post('bookings')
  @Throttle(getThrottleConfig(5))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a booking' })
  @ApiResponse({ status: 201, description: 'Booking created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Restaurant or sector not found' })
  @ApiResponse({ status: 409, description: 'No capacity' })
  @ApiResponse({ status: 422, description: 'Outside service window' })
  async createBooking(
    @Body() body: CreateBookingRequest,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const requestId = randomUUID();
    const startTime = Date.now();

    try {
      // Validate idempotency key is provided
      if (
        !idempotencyKey ||
        (typeof idempotencyKey === 'string' && idempotencyKey.trim() === '')
      ) {
        throw new BadRequestException({
          error: 'invalid_input',
          detail: 'Idempotency-Key header is required',
        });
      }

      // Validate body
      const validated = CreateBookingSchema.parse(body);

      this.logger.log({
        requestId,
        sectorId: validated.sectorId,
        partySize: validated.partySize,
        duration: validated.durationMinutes,
        op: 'create_booking',
        outcome: 'success',
      });

      const result = await this.bookingCommandService.createBooking(
        validated,
        idempotencyKey,
      );

      this.logger.log({
        requestId,
        durationMs: Date.now() - startTime,
        outcome: 'success',
        op: 'create_booking',
      });

      return result;
    } catch (error: any) {
      this.logger.error('Create booking failed', error, {
        requestId,
        durationMs: Date.now() - startTime,
        outcome: 'error',
        op: 'create_booking',
      });

      if (error instanceof ConflictException) {
        throw error;
      }

      if (error instanceof NotFoundException) {
        throw error;
      }

      if (error instanceof UnprocessableEntityException) {
        throw error;
      }

      if (error instanceof BadRequestException) {
        throw error;
      }

      if (error.name === 'ZodError') {
        throw new BadRequestException({
          error: 'invalid_input',
          detail: error.errors,
        });
      }

      throw new BadRequestException({
        error: 'invalid_input',
        detail: error.message,
      });
    }
  }

  @Get('bookings/day')
  @Throttle(getThrottleConfig(100))
  @ApiOperation({ summary: 'List bookings for a day' })
  @ApiResponse({ status: 200, description: 'Bookings listed' })
  @ApiResponse({ status: 404, description: 'Restaurant or sector not found' })
  async listBookings(@Query() query: ListBookingsQuery) {
    const requestId = randomUUID();
    const startTime = Date.now();

    try {
      // Validate query
      const validated = ListBookingsQuerySchema.parse(query);

      this.logger.log({
        requestId,
        sectorId: validated.sectorId,
        op: 'list_bookings',
        outcome: 'success',
      });

      const result = await this.bookingQueryService.listBookings(validated);

      this.logger.log({
        requestId,
        durationMs: Date.now() - startTime,
        outcome: 'success',
        op: 'list_bookings',
      });

      return result;
    } catch (error: any) {
      this.logger.error('List bookings failed', error, {
        requestId,
        durationMs: Date.now() - startTime,
        outcome: 'error',
        op: 'list_bookings',
      });

      if (error instanceof NotFoundException) {
        throw error;
      }

      if (error.name === 'ZodError') {
        throw new BadRequestException({
          error: 'invalid_input',
          detail: error.errors,
        });
      }

      throw new BadRequestException({
        error: 'invalid_input',
        detail: error.message,
      });
    }
  }

  @Delete('bookings/:id')
  @Throttle(getThrottleConfig(5))
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a booking' })
  @ApiResponse({ status: 204, description: 'Booking cancelled' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  async cancelBooking(@Param('id') id: string) {
    const requestId = randomUUID();
    const startTime = Date.now();

    try {
      await this.bookingCommandService.cancelBooking(id);

      this.logger.log({
        requestId,
        op: 'cancel_booking',
        durationMs: Date.now() - startTime,
        outcome: 'success',
      });
    } catch (error: any) {
      this.logger.error('Cancel booking failed', error, {
        requestId,
        durationMs: Date.now() - startTime,
        outcome: 'error',
        op: 'cancel_booking',
      });

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw error;
    }
  }

  @Post('blackouts')
  @Throttle(getThrottleConfig(5))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a blackout' })
  @ApiResponse({ status: 201, description: 'Blackout created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({
    status: 404,
    description: 'Restaurant, sector, or table not found',
  })
  async createBlackout(@Body() body: CreateBlackoutRequest) {
    const requestId = randomUUID();
    const startTime = Date.now();

    try {
      // Validate body
      const validated = CreateBlackoutSchema.parse(body);

      this.logger.log({
        requestId,
        restaurantId: validated.restaurantId,
        sectorId: validated.sectorId,
        reason: validated.reason,
        op: 'create_blackout',
        outcome: 'success',
      });

      const result =
        await this.blackoutCommandService.createBlackout(validated);

      this.logger.log({
        requestId,
        durationMs: Date.now() - startTime,
        outcome: 'success',
        op: 'create_blackout',
      });

      return result;
    } catch (error: any) {
      this.logger.error('Create blackout failed', error, {
        requestId,
        durationMs: Date.now() - startTime,
        outcome: 'error',
        op: 'create_blackout',
      });

      if (error instanceof ConflictException) {
        throw error;
      }

      if (error instanceof NotFoundException) {
        throw error;
      }

      if (error.name === 'ZodError') {
        throw new BadRequestException({
          error: 'invalid_input',
          detail: error.errors,
        });
      }

      throw new BadRequestException({
        error: 'invalid_input',
        detail: error.message,
      });
    }
  }

  @Get('blackouts')
  @Throttle(getThrottleConfig(100))
  @ApiOperation({ summary: 'List blackouts for a day' })
  @ApiResponse({ status: 200, description: 'Blackouts listed' })
  @ApiResponse({ status: 404, description: 'Restaurant or sector not found' })
  async listBlackouts(@Query() query: ListBlackoutsQuery) {
    const requestId = randomUUID();
    const startTime = Date.now();

    try {
      // Validate query
      const validated = ListBlackoutsQuerySchema.parse(query);

      this.logger.log({
        requestId,
        sectorId: validated.sectorId,
        op: 'list_blackouts',
        outcome: 'success',
      });

      const result = await this.blackoutQueryService.listBlackouts(validated);

      this.logger.log({
        requestId,
        durationMs: Date.now() - startTime,
        outcome: 'success',
        op: 'list_blackouts',
      });

      return result;
    } catch (error: any) {
      this.logger.error('List blackouts failed', error, {
        requestId,
        durationMs: Date.now() - startTime,
        outcome: 'error',
        op: 'list_blackouts',
      });

      if (error instanceof NotFoundException) {
        throw error;
      }

      if (error.name === 'ZodError') {
        throw new BadRequestException({
          error: 'invalid_input',
          detail: error.errors,
        });
      }

      throw new BadRequestException({
        error: 'invalid_input',
        detail: error.message,
      });
    }
  }

  @Delete('blackouts/:id')
  @Throttle(getThrottleConfig(5))
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a blackout' })
  @ApiResponse({ status: 204, description: 'Blackout deleted' })
  @ApiResponse({ status: 404, description: 'Blackout not found' })
  async deleteBlackout(@Param('id') id: string) {
    const requestId = randomUUID();
    const startTime = Date.now();

    try {
      await this.blackoutCommandService.deleteBlackout(id);

      this.logger.log({
        requestId,
        op: 'delete_blackout',
        durationMs: Date.now() - startTime,
        outcome: 'success',
      });
    } catch (error: any) {
      this.logger.error('Delete blackout failed', error, {
        requestId,
        durationMs: Date.now() - startTime,
        outcome: 'error',
        op: 'delete_blackout',
      });

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw error;
    }
  }

  @Get('metrics')
  @Throttle(getThrottleConfig(100))
  @ApiOperation({ summary: 'Get metrics' })
  @ApiResponse({ status: 200, description: 'Metrics retrieved' })
  getMetrics() {
    return this.metricsService.getMetrics();
  }
}
