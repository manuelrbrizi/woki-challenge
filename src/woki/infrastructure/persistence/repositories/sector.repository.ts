import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sector } from '../../../domain/entities/sector.entity';
import { SectorRepository as ISectorRepository } from '../../../ports/repositories/sector.repository.interface';

@Injectable()
export class SectorRepository implements ISectorRepository {
  constructor(
    @InjectRepository(Sector)
    private readonly repository: Repository<Sector>,
  ) {}

  async findById(id: string): Promise<Sector | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByRestaurantId(restaurantId: string): Promise<Sector[]> {
    return this.repository.find({ where: { restaurantId } });
  }
}

