import { ServiceWindow } from '../../domain/entities/service-window.entity';

export interface ServiceWindowRepository {
  findByRestaurantId(restaurantId: string): Promise<ServiceWindow[]>;
}

