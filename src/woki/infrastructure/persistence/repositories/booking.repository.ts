import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThan } from 'typeorm';
import { Booking } from '../../../domain/entities/booking.entity';
import { BookingStatus } from '../../../domain/types/booking-status.enum';
import { BookingRepository as IBookingRepository } from '../../../ports/repositories/booking.repository.interface';
import { startOfDay, endOfDay } from 'date-fns';

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
  ): Promise<Booking[]> {
    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);

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

