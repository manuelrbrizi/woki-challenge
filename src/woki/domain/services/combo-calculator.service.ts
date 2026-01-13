import { Injectable } from '@nestjs/common';
import { Table } from '../entities/table.entity';

@Injectable()
export class ComboCalculatorService {
  /**
   * Calculate capacity range for a combination of tables.
   * Heuristic: Simple sum of min and max capacities.
   *
   * Rationale: This approach is simple, predictable, and allows flexible seating.
   * It assumes tables can be combined without significant space penalties.
   */
  calculateCapacity(tables: Table[]): {
    minCapacity: number;
    maxCapacity: number;
  } {
    const minCapacity = tables.reduce((sum, table) => sum + table.minSize, 0);
    const maxCapacity = tables.reduce((sum, table) => sum + table.maxSize, 0);

    return { minCapacity, maxCapacity };
  }
}
