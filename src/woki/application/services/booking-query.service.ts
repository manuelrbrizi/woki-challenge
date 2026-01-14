import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { parseISO } from 'date-fns';
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
import { GapDiscoveryService } from '../../domain/services/gap-discovery.service';
import { ComboCalculatorService } from '../../domain/services/combo-calculator.service';
import { ComboCandidate } from '../../domain/types/combo-candidate.type';
import {
  DiscoverSeatsQuery,
  DiscoverSeatsResponse,
} from '../dto/discover-seats.dto';
import {
  ListBookingsQuery,
  ListBookingsResponse,
} from '../dto/list-bookings.dto';
import { validateWindowWithinServiceHours } from '../utils/window-validation.util';

@Injectable()
export class BookingQueryService {
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
    private readonly gapDiscoveryService: GapDiscoveryService,
    private readonly comboCalculatorService: ComboCalculatorService,
  ) {}

  async discoverSeats(
    query: DiscoverSeatsQuery,
  ): Promise<DiscoverSeatsResponse> {
    // Validate and parse date
    const date = parseISO(query.date);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date format');
    }

    // Validate duration is multiple of 15
    if (query.duration % 15 !== 0) {
      throw new Error('Duration must be a multiple of 15 minutes');
    }

    // Validate duration range (30-180 suggested)
    if (query.duration < 30 || query.duration > 180) {
      throw new Error('Duration must be between 30 and 180 minutes');
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

    // Get all tables in sector
    const tables = await this.tableRepository.findBySectorId(sector.id);
    if (tables.length === 0) {
      return {
        slotMinutes: 15,
        durationMinutes: query.duration,
        candidates: [],
      };
    }

    // Get all bookings for the date (using restaurant timezone)
    const bookings = await this.bookingRepository.findByDate(
      restaurant.id,
      sector.id,
      date,
      restaurant.timezone,
    );

    // Get service windows for the restaurant
    const serviceWindows =
      await this.serviceWindowRepository.findByRestaurantId(restaurant.id);

    // Validate windowStart/windowEnd is within service windows (if provided)
    if (query.windowStart && query.windowEnd) {
      validateWindowWithinServiceHours(
        query.windowStart,
        query.windowEnd,
        serviceWindows,
      );
    }

    // Find candidates
    const candidates = this.findCandidates(
      tables,
      bookings,
      date,
      query.duration,
      query.partySize,
      restaurant,
      serviceWindows.map((w) => ({ start: w.start, end: w.end })),
      query.windowStart,
      query.windowEnd,
    );

    // Apply limit if specified
    const limitedCandidates = query.limit
      ? candidates.slice(0, query.limit)
      : candidates;

    return {
      slotMinutes: 15,
      durationMinutes: query.duration,
      candidates: limitedCandidates.map((c) => ({
        kind: c.kind,
        tableIds: c.tableIds,
        start: c.interval.start.toISOString(),
        end: c.interval.end.toISOString(),
      })),
    };
  }

  async listBookings(query: ListBookingsQuery): Promise<ListBookingsResponse> {
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

    // Get bookings (using restaurant timezone)
    const bookings = await this.bookingRepository.findByDate(
      query.restaurantId,
      query.sectorId,
      date,
      restaurant.timezone,
    );

    return {
      date: query.date,
      items: bookings.map((booking) => ({
        id: booking.id,
        tableIds: booking.tableIds,
        partySize: booking.partySize,
        start: booking.start.toISOString(),
        end: booking.end.toISOString(),
        status: booking.status,
      })),
    };
  }

  findCandidates(
    tables: Array<{ id: string; minSize: number; maxSize: number }>,
    bookings: Array<{
      tableIds: string[];
      start: Date;
      end: Date;
      status: string;
    }>,
    date: Date,
    durationMinutes: number,
    partySize: number,
    restaurant: { timezone: string },
    serviceWindows: Array<{ start: string; end: string }>,
    windowStart?: string,
    windowEnd?: string,
  ): ComboCandidate[] {
    const candidates: ComboCandidate[] = [];

    // Single table candidates
    for (const table of tables) {
      if (partySize >= table.minSize && partySize <= table.maxSize) {
        const gaps = this.gapDiscoveryService.findGapsForTable(
          bookings as any,
          table.id,
          date,
          durationMinutes,
          restaurant as any,
          serviceWindows,
          windowStart,
          windowEnd,
        );

        // Sort gaps by start time to ensure deterministic candidate generation
        const sortedGaps = gaps.sort(
          (a, b) => a.start.getTime() - b.start.getTime(),
        );

        for (const gap of sortedGaps) {
          candidates.push({
            tableIds: [table.id],
            minCapacity: table.minSize,
            maxCapacity: table.maxSize,
            interval: gap,
            kind: 'single',
          });
        }
      }
    }

    // Combo candidates (all combinations of 2+ tables)
    const comboCandidates = this.findComboCandidates(
      tables,
      bookings,
      date,
      durationMinutes,
      partySize,
      restaurant as any,
      serviceWindows,
      windowStart,
      windowEnd,
    );

    candidates.push(...comboCandidates);

    // Sort by WokiBrain selection strategy
    const sorted = candidates.sort((a, b) => {
      // Singles first
      if (a.kind === 'single' && b.kind === 'combo') return -1;
      if (a.kind === 'combo' && b.kind === 'single') return 1;

      // Among singles, earlier slots, then by table ID for tie-breaking
      if (a.kind === 'single' && b.kind === 'single') {
        const timeDiff =
          a.interval.start.getTime() - b.interval.start.getTime();
        if (timeDiff !== 0) return timeDiff;
        // Break ties by table ID (alphabetically) for deterministic selection
        return a.tableIds[0].localeCompare(b.tableIds[0]);
      }

      // Among combos, fewer tables, then earlier slots
      if (a.kind === 'combo' && b.kind === 'combo') {
        const tableDiff = a.tableIds.length - b.tableIds.length;
        if (tableDiff !== 0) return tableDiff;
        return a.interval.start.getTime() - b.interval.start.getTime();
      }

      return 0;
    });

    return sorted;
  }

  private findComboCandidates(
    tables: Array<{ id: string; minSize: number; maxSize: number }>,
    bookings: Array<{
      tableIds: string[];
      start: Date;
      end: Date;
      status: string;
    }>,
    date: Date,
    durationMinutes: number,
    partySize: number,
    restaurant: { timezone: string },
    serviceWindows: Array<{ start: string; end: string }>,
    windowStart?: string,
    windowEnd?: string,
  ): ComboCandidate[] {
    const candidates: ComboCandidate[] = [];

    // Generate all combinations of 2+ tables (pruned: only if sum of mins <= partySize <= sum of maxs)
    const combinations = this.generateTableCombinations(tables, partySize);

    for (const combo of combinations) {
      const { minCapacity, maxCapacity } =
        this.comboCalculatorService.calculateCapacity(combo as any);

      if (partySize >= minCapacity && partySize <= maxCapacity) {
        const tableIds = combo.map((t) => t.id);
        const gaps = this.gapDiscoveryService.findComboGaps(
          bookings as any,
          tableIds,
          date,
          durationMinutes,
          restaurant as any,
          serviceWindows,
          windowStart,
          windowEnd,
        );

        for (const gap of gaps) {
          candidates.push({
            tableIds,
            minCapacity,
            maxCapacity,
            interval: gap,
            kind: 'combo',
          });
        }
      }
    }

    return candidates;
  }

  private generateTableCombinations(
    tables: Array<{ id: string; minSize: number; maxSize: number }>,
    partySize: number,
  ): Array<Array<{ id: string; minSize: number; maxSize: number }>> {
    const combinations: Array<
      Array<{ id: string; minSize: number; maxSize: number }>
    > = [];

    // Only keep tables that can potentially contribute capacity
    // A table is useful if it has any positive maxSize
    const usefulTables = tables.filter((t) => t.maxSize > 0);

    // Need at least 2 tables to form a combo
    if (usefulTables.length < 2) {
      return [];
    }

    // Deterministic order: larger tables first for better pruning
    const sortedTables = [...usefulTables].sort(
      (a, b) => b.maxSize - a.maxSize,
    );

    // Reasonable upper bound to avoid combinatorial explosion
    const MAX_COMBO_SIZE = 6;

    const backtrack = (
      startIndex: number,
      current: Array<{ id: string; minSize: number; maxSize: number }>,
      currentMin: number,
      currentMax: number,
    ) => {
      // If current combo already fits the party, record it
      // Do NOT return here: adding more tables may produce other valid combos
      if (
        current.length >= 2 &&
        currentMin <= partySize &&
        partySize <= currentMax
      ) {
        combinations.push([...current]);
      }

      // Pruning 1: limit maximum combo size
      if (current.length === MAX_COMBO_SIZE) {
        return;
      }

      for (let i = startIndex; i < sortedTables.length; i++) {
        const table = sortedTables[i];
        const newMin = currentMin + table.minSize;
        const newMax = currentMax + table.maxSize;

        // Pruning 2 (safe):
        // Even if we add ALL remaining tables, this combo can never reach partySize
        // Calculate the maximum possible capacity if we add all remaining tables
        let maxPossibleCapacity = newMax;
        for (let j = i + 1; j < sortedTables.length; j++) {
          maxPossibleCapacity += sortedTables[j].maxSize;
        }

        if (maxPossibleCapacity < partySize) {
          continue;
        }

        backtrack(
          i + 1, // Avoid duplicates by only moving forward
          [...current, table],
          newMin,
          newMax,
        );
      }
    };

    backtrack(0, [], 0, 0);

    return combinations;
  }
}
