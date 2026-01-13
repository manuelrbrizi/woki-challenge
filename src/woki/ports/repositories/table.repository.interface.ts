import { Table } from '../../domain/entities/table.entity';

export interface TableRepository {
  findById(id: string): Promise<Table | null>;
  findBySectorId(sectorId: string): Promise<Table[]>;
  findByIds(ids: string[]): Promise<Table[]>;
}
