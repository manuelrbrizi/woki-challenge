import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Restaurant } from '../../../domain/entities/restaurant.entity';
import { RestaurantRepository as IRestaurantRepository } from '../../../ports/repositories/restaurant.repository.interface';

@Injectable()
export class RestaurantRepository implements IRestaurantRepository {
  constructor(
    @InjectRepository(Restaurant)
    private readonly repository: Repository<Restaurant>,
  ) {}

  async findById(id: string): Promise<Restaurant | null> {
    return this.repository.findOne({ where: { id } });
  }
}
