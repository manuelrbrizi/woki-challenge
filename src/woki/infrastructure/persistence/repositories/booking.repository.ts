import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Booking } from '../../../domain/entities/booking.entity';
import { BookingStatus } from '../../../domain/types/booking-status.enum';
import { BookingRepository as IBookingRepository } from '../../../ports/repositories/booking.repository.interface';
import { startOfDay, endOfDay } from 'date-fns';
import { zonedTimeToUtc } from 'date-fns-tz';

@Injectable()
export class BookingRepository implements IBookingRepository {
  constructor(
    @InjectRepository(Booking)
    private readonly repository: Repository<Booking>,
  ) {}

  async findById(id: string): Promise<Booking | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByDate(
    restaurantId: string,
    sectorId: string,
    date: Date,
    timezone?: string,
  ): Promise<Booking[]> {
    // If timezone is provided, calculate day boundaries in that timezone
    // Otherwise, use UTC (bookings are stored in UTC)
    let dayStart: Date;
    let dayEnd: Date;

    if (timezone) {
      // The date parameter is a Date object representing a day (e.g., from parseISO('2025-10-22'))
      // We need to interpret this as a date in the restaurant's timezone
      // Extract year, month, day from the date
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth();
      const day = date.getUTCDate();

      // Create a date string in the format YYYY-MM-DD and parse it in the restaurant's timezone
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
  ): Promise<Booking[]> {
    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);

    // Find bookings where any of the tableIds overlap
    // This is a simplified query - in production, you'd want a more efficient approach
    const bookings = await this.repository.find({
      where: {
        start: Between(dayStart, dayEnd),
        status: BookingStatus.CONFIRMED,
      },
    });

    // Filter bookings that involve any of the specified tables
    return bookings.filter((booking) =>
      booking.tableIds.some((id) => tableIds.includes(id)),
    );
  }

  async create(booking: Booking): Promise<Booking> {
    const newBooking = this.repository.create(booking);
    return this.repository.save(newBooking);
  }

  async update(booking: Booking): Promise<Booking> {
    return this.repository.save(booking);
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
