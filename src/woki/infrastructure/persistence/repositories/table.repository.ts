import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Table } from '../../../domain/entities/table.entity';
import { TableRepository as ITableRepository } from '../../../ports/repositories/table.repository.interface';

@Injectable()
export class TableRepository implements ITableRepository {
  constructor(
    @InjectRepository(Table)
    private readonly repository: Repository<Table>,
  ) {}

  async findById(id: string): Promise<Table | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findBySectorId(sectorId: string): Promise<Table[]> {
    return this.repository.find({ where: { sectorId } });
  }

  async findByIds(ids: string[]): Promise<Table[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.repository.find({ where: { id: In(ids) } });
  }
}
