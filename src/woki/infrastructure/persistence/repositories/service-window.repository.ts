import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceWindow } from '../../../domain/entities/service-window.entity';
import { ServiceWindowRepository as IServiceWindowRepository } from '../../../ports/repositories/service-window.repository.interface';

@Injectable()
export class ServiceWindowRepository implements IServiceWindowRepository {
  constructor(
    @InjectRepository(ServiceWindow)
    private readonly repository: Repository<ServiceWindow>,
  ) {}

  async findByRestaurantId(restaurantId: string): Promise<ServiceWindow[]> {
    return this.repository.find({
      where: { restaurantId },
      order: { start: 'ASC' },
    });
  }
}

