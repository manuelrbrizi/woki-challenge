import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BookingStatus } from '../types/booking-status.enum';

@Entity('bookings')
export class Booking {
  @PrimaryColumn()
  id: string;

  @Column()
  restaurantId: string;

  @Column()
  sectorId: string;

  @Column('simple-json')
  tableIds: string[];

  @Column()
  partySize: number;

  @Column()
  start: Date;

  @Column()
  end: Date; // exclusive

  @Column()
  durationMinutes: number;

  @Column({
    type: 'varchar',
    enum: BookingStatus,
    default: BookingStatus.CONFIRMED,
  })
  status: BookingStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
