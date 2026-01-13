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
import { BookingQueryService } from '../../application/services/booking-query.service';
import { BookingCommandService } from '../../application/services/booking-command.service';
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
import { BookingRepository as IBookingRepository } from '../../ports/repositories/booking.repository.interface';
import { LoggerService } from '../logging/logger.service';
import { randomUUID } from 'crypto';
import { Inject } from '@nestjs/common';
import { BOOKING_REPOSITORY } from '../../tokens';

@ApiTags('woki')
@Controller('woki')
export class WokiController {
  constructor(
    private readonly bookingQueryService: BookingQueryService,
    private readonly bookingCommandService: BookingCommandService,
    @Inject(BOOKING_REPOSITORY)
    private readonly bookingRepository: IBookingRepository,
    private readonly logger: LoggerService,
  ) {}

  @Get('discover')
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
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a booking' })
  @ApiResponse({ status: 201, description: 'Booking created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Restaurant or sector not found' })
  @ApiResponse({ status: 409, description: 'No capacity' })
  @ApiResponse({ status: 422, description: 'Outside service window' })
  async createBooking(
    @Body() body: CreateBookingRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const requestId = randomUUID();
    const startTime = Date.now();

    try {
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
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a booking' })
  @ApiResponse({ status: 204, description: 'Booking cancelled' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  async cancelBooking(@Param('id') id: string) {
    const requestId = randomUUID();
    const startTime = Date.now();

    try {
      const booking = await this.bookingRepository.findById(id);
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }

      await this.bookingRepository.delete(id);

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
}
