import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tables')
export class Table {
  @PrimaryColumn()
  id: string;

  @Column()
  sectorId: string;

  @Column()
  name: string;

  @Column()
  minSize: number;

  @Column()
  maxSize: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
