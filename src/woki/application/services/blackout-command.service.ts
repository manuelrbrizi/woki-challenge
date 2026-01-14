import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { parseISO } from 'date-fns';
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
    // Parse dates
    const start = parseISO(request.start);
    const end = parseISO(request.end);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    if (start >= end) {
      throw new BadRequestException('Start time must be before end time');
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

    return this.toResponse(savedBlackout);
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

  private toResponse(blackout: Blackout): CreateBlackoutResponse {
    return {
      id: blackout.id,
      restaurantId: blackout.restaurantId,
      sectorId: blackout.sectorId,
      tableIds: blackout.tableIds,
      start: blackout.start.toISOString(),
      end: blackout.end.toISOString(),
      reason: blackout.reason,
      notes: blackout.notes,
      createdAt: blackout.createdAt.toISOString(),
      updatedAt: blackout.updatedAt.toISOString(),
    };
  }
}
