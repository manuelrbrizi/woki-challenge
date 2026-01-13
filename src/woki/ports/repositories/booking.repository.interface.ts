import { Booking } from '../../domain/entities/booking.entity';

export interface BookingRepository {
  findById(id: string): Promise<Booking | null>;
  findByDate(
    restaurantId: string,
    sectorId: string,
    date: Date,
  ): Promise<Booking[]>;
  findByTableIdsAndDate(tableIds: string[], date: Date): Promise<Booking[]>;
  create(booking: Booking): Promise<Booking>;
  update(booking: Booking): Promise<Booking>;
  delete(id: string): Promise<void>;
}
