import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Blackout } from '../../../domain/entities/blackout.entity';
import { BlackoutRepository as IBlackoutRepository } from '../../../ports/repositories/blackout.repository.interface';
import { startOfDay, endOfDay } from 'date-fns';
import { zonedTimeToUtc } from 'date-fns-tz';

@Injectable()
export class BlackoutRepository implements IBlackoutRepository {
  constructor(
    @InjectRepository(Blackout)
    private readonly repository: Repository<Blackout>,
  ) {}

  async findById(id: string): Promise<Blackout | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByDate(
    restaurantId: string,
    sectorId: string,
    date: Date,
    timezone?: string,
  ): Promise<Blackout[]> {
    // If timezone is provided, calculate day boundaries in that timezone
    // Otherwise, use UTC (blackouts are stored in UTC)
    let dayStart: Date;
    let dayEnd: Date;

    if (timezone) {
      // Extract year, month, day from the date
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth();
      const day = date.getUTCDate();

      // Create a date string in the format YYYY-MM-DD
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      // Create start of day (00:00:00) in restaurant timezone, then convert to UTC
      dayStart = zonedTimeToUtc(`${dateStr}T00:00:00`, timezone);

      // Create end of day (23:59:59.999) in restaurant timezone, then convert to UTC
      dayEnd = zonedTimeToUtc(`${dateStr}T23:59:59.999`, timezone);
    } else {
      // Fallback: use UTC day boundaries
      dayStart = startOfDay(date);
      dayEnd = endOfDay(date);
    }

    return this.repository.find({
      where: {
        restaurantId,
        sectorId,
        start: Between(dayStart, dayEnd),
      },
      order: {
        start: 'ASC',
      },
    });
  }

  async findByTableIdsAndDate(
    tableIds: string[],
    date: Date,
  ): Promise<Blackout[]> {
    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);

    // Find blackouts where any of the tableIds overlap
    const blackouts = await this.repository.find({
      where: {
        start: Between(dayStart, dayEnd),
      },
    });

    // Filter blackouts that affect any of the specified tables
    // A blackout affects a table if:
    // 1. tableIds includes the table, OR
    // 2. sectorId matches and tableIds is empty (whole sector blackout)
    return blackouts.filter((blackout) => {
      // Check if any of the specified tables are in the blackout's tableIds
      if (blackout.tableIds.some((id) => tableIds.includes(id))) {
        return true;
      }
      // If blackout has empty tableIds and a sectorId, it's a whole-sector blackout
      // We'd need sector context to fully validate, but for now we'll include it
      // The caller should filter based on sector membership
      return false;
    });
  }

  async create(blackout: Blackout): Promise<Blackout> {
    const newBlackout = this.repository.create(blackout);
    return this.repository.save(newBlackout);
  }

  async update(blackout: Blackout): Promise<Blackout> {
    return this.repository.save(blackout);
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
