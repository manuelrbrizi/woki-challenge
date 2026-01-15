import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { parseISO } from 'date-fns';
import { zonedTimeToUtc, formatInTimeZone } from 'date-fns-tz';
import { randomUUID } from 'crypto';
import { RestaurantRepository as IRestaurantRepository } from '../../ports/repositories/restaurant.repository.interface';
import { SectorRepository as ISectorRepository } from '../../ports/repositories/sector.repository.interface';
import { TableRepository as ITableRepository } from '../../ports/repositories/table.repository.interface';
import { BlackoutRepository as IBlackoutRepository } from '../../ports/repositories/blackout.repository.interface';
import {
  RESTAURANT_REPOSITORY,
  SECTOR_REPOSITORY,
  TABLE_REPOSITORY,
  BLACKOUT_REPOSITORY,
} from '../../tokens';
import { Blackout } from '../../domain/entities/blackout.entity';
import {
  CreateBlackoutRequest,
  CreateBlackoutResponse,
} from '../dto/create-blackout.dto';

@Injectable()
export class BlackoutCommandService {
  constructor(
    @Inject(RESTAURANT_REPOSITORY)
    private readonly restaurantRepository: IRestaurantRepository,
    @Inject(SECTOR_REPOSITORY)
    private readonly sectorRepository: ISectorRepository,
    @Inject(TABLE_REPOSITORY)
    private readonly tableRepository: ITableRepository,
    @Inject(BLACKOUT_REPOSITORY)
    private readonly blackoutRepository: IBlackoutRepository,
  ) {}

  async createBlackout(
    request: CreateBlackoutRequest,
  ): Promise<CreateBlackoutResponse> {
    // Parse date
    const date = parseISO(request.date);
    if (isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    // Get restaurant first (needed for timezone conversion)
    const restaurant = await this.restaurantRepository.findById(
      request.restaurantId,
    );
    if (!restaurant) {
      throw new NotFoundException({
        error: 'not_found',
        detail: 'Restaurant not found',
      });
    }

    // Parse times in restaurant timezone and convert to UTC
    const start = this.parseTimeInTimezone(
      date,
      request.startTime,
      restaurant.timezone,
    );
    const end = this.parseTimeInTimezone(
      date,
      request.endTime,
      restaurant.timezone,
    );

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid time format');
    }

    if (start >= end) {
      throw new BadRequestException('Start time must be before end time');
    }

    // Validate sector if provided
    let sectorId: string | null = null;
    if (request.sectorId) {
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

      sectorId = sector.id;
    }

    // Validate tables if provided
    let tableIds: string[] = [];
    if (request.tableIds && request.tableIds.length > 0) {
      // Validate all tables exist and belong to the sector
      if (!sectorId) {
        throw new BadRequestException(
          'sectorId is required when specifying tableIds',
        );
      }

      const tables = await this.tableRepository.findBySectorId(sectorId);
      const tableMap = new Map(tables.map((t) => [t.id, t]));

      for (const tableId of request.tableIds) {
        if (!tableMap.has(tableId)) {
          throw new NotFoundException({
            error: 'not_found',
            detail: `Table ${tableId} not found in sector`,
          });
        }
      }

      tableIds = request.tableIds;
    } else if (sectorId) {
      // Empty tableIds with sectorId means whole sector blackout
      tableIds = [];
    } else {
      throw new BadRequestException(
        'Either sectorId or tableIds must be provided',
      );
    }

    // Create blackout
    const blackout = new Blackout();
    blackout.id = `BLK_${randomUUID().substring(0, 8).toUpperCase()}`;
    blackout.restaurantId = request.restaurantId;
    blackout.sectorId = sectorId;
    blackout.tableIds = tableIds;
    blackout.start = start;
    blackout.end = end;
    blackout.reason = request.reason;
    blackout.notes = request.notes || null;
    blackout.createdAt = new Date();
    blackout.updatedAt = new Date();

    const savedBlackout = await this.blackoutRepository.create(blackout);

    return this.toResponse(savedBlackout, restaurant.timezone);
  }

  async deleteBlackout(id: string): Promise<void> {
    const blackout = await this.blackoutRepository.findById(id);
    if (!blackout) {
      throw new NotFoundException({
        error: 'not_found',
        detail: 'Blackout not found',
      });
    }

    await this.blackoutRepository.delete(id);
  }

  /**
   * Parse a time string (HH:mm) in the restaurant's timezone for a given date,
   * and convert it to UTC.
   * This matches the pattern used in the booking API for consistency.
   */
  private parseTimeInTimezone(
    date: Date,
    timeStr: string,
    timezone: string,
  ): Date {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();

    // Create date string in the format YYYY-MM-DDTHH:mm:00
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

    // Parse as if it's in the restaurant timezone, then convert to UTC
    return zonedTimeToUtc(new Date(dateStr), timezone);
  }

  private toResponse(
    blackout: Blackout,
    timezone: string,
  ): CreateBlackoutResponse {
    const formatDateInTimezone = (date: Date) =>
      formatInTimeZone(date, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX");

    return {
      id: blackout.id,
      restaurantId: blackout.restaurantId,
      sectorId: blackout.sectorId,
      tableIds: blackout.tableIds,
      start: formatDateInTimezone(blackout.start),
      end: formatDateInTimezone(blackout.end),
      reason: blackout.reason,
      notes: blackout.notes,
      createdAt: formatDateInTimezone(blackout.createdAt),
      updatedAt: formatDateInTimezone(blackout.updatedAt),
    };
  }
}
