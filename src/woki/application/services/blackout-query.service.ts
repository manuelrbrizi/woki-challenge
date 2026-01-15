import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { RestaurantRepository as IRestaurantRepository } from '../../ports/repositories/restaurant.repository.interface';
import { SectorRepository as ISectorRepository } from '../../ports/repositories/sector.repository.interface';
import { BlackoutRepository as IBlackoutRepository } from '../../ports/repositories/blackout.repository.interface';
import {
  RESTAURANT_REPOSITORY,
  SECTOR_REPOSITORY,
  BLACKOUT_REPOSITORY,
} from '../../tokens';
import {
  ListBlackoutsQuery,
  ListBlackoutsResponse,
} from '../dto/list-blackouts.dto';

@Injectable()
export class BlackoutQueryService {
  constructor(
    @Inject(RESTAURANT_REPOSITORY)
    private readonly restaurantRepository: IRestaurantRepository,
    @Inject(SECTOR_REPOSITORY)
    private readonly sectorRepository: ISectorRepository,
    @Inject(BLACKOUT_REPOSITORY)
    private readonly blackoutRepository: IBlackoutRepository,
  ) {}

  async listBlackouts(
    query: ListBlackoutsQuery,
  ): Promise<ListBlackoutsResponse> {
    // Parse date
    const date = parseISO(query.date);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date format');
    }

    // Get restaurant
    const restaurant = await this.restaurantRepository.findById(
      query.restaurantId,
    );
    if (!restaurant) {
      throw new NotFoundException({
        error: 'not_found',
        detail: 'Restaurant not found',
      });
    }

    // Get sector
    const sector = await this.sectorRepository.findById(query.sectorId);
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

    // Get blackouts (using restaurant timezone)
    const blackouts = await this.blackoutRepository.findByDate(
      query.restaurantId,
      query.sectorId,
      date,
      restaurant.timezone,
    );

    const formatDateInTimezone = (date: Date) =>
      formatInTimeZone(date, restaurant.timezone, "yyyy-MM-dd'T'HH:mm:ssXXX");

    return {
      date: query.date,
      items: blackouts.map((blackout) => ({
        id: blackout.id,
        sectorId: blackout.sectorId,
        tableIds: blackout.tableIds,
        start: formatDateInTimezone(blackout.start),
        end: formatDateInTimezone(blackout.end),
        reason: blackout.reason,
        notes: blackout.notes,
      })),
    };
  }
}
