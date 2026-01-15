import { Restaurant } from '../../domain/entities/restaurant.entity';

export interface RestaurantRepository {
  findById(id: string): Promise<Restaurant | null>;
}
