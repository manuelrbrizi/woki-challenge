import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BlackoutReason } from '../types/blackout-reason.enum';

@Entity('blackouts')
export class Blackout {
  @PrimaryColumn()
  id: string;

  @Column()
  restaurantId: string;

  @Column({ type: 'varchar', nullable: true })
  sectorId: string | null; // null means it's table-specific, not sector-wide

  @Column('simple-json')
  tableIds: string[]; // Empty array means whole sector (if sectorId is set)

  @Column()
  start: Date;

  @Column()
  end: Date; // exclusive

  @Column({
    type: 'varchar',
    enum: BlackoutReason,
  })
  reason: BlackoutReason;

  @Column({ type: 'varchar', nullable: true })
  notes: string | null; // Optional description

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
