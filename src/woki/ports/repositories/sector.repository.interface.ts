import { Sector } from '../../domain/entities/sector.entity';

export interface SectorRepository {
  findById(id: string): Promise<Sector | null>;
  findByRestaurantId(restaurantId: string): Promise<Sector[]>;
}
