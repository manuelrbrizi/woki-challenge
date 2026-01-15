import { Blackout } from '../../domain/entities/blackout.entity';

export interface BlackoutRepository {
  findById(id: string): Promise<Blackout | null>;
  findByDate(
    restaurantId: string,
    sectorId: string,
    date: Date,
    timezone?: string,
  ): Promise<Blackout[]>;
  findByTableIdsAndDate(tableIds: string[], date: Date): Promise<Blackout[]>;
  create(blackout: Blackout): Promise<Blackout>;
  update(blackout: Blackout): Promise<Blackout>;
  delete(id: string): Promise<void>;
}
