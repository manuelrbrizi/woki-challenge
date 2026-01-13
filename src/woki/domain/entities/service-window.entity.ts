import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('service_windows')
export class ServiceWindow {
  @PrimaryColumn()
  id: string;

  @Column()
  restaurantId: string;

  @Column()
  start: string; // HH:mm format

  @Column()
  end: string; // HH:mm format

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

