import { Injectable } from '@nestjs/common';
import { ComboCandidate } from '../types/combo-candidate.type';

@Injectable()
export class WokiBrainSelectorService {
  /**
   * Deterministic selection strategy for choosing among valid candidates.
   *
   * Selection criteria (in order of priority):
   * 1. Prefer single tables over combos
   * 2. Among singles: prefer earlier slots
   * 3. Among combos: prefer fewer tables, then earlier slots
   *
   * This ensures deterministic results: same input → same output.
   */
  selectBestCandidate(candidates: ComboCandidate[]): ComboCandidate | null {
    if (candidates.length === 0) {
      return null;
    }

    // Separate singles and combos
    const singles = candidates.filter((c) => c.kind === 'single');
    const combos = candidates.filter((c) => c.kind === 'combo');

    // Prefer singles over combos
    if (singles.length > 0) {
      // Among singles, prefer earlier slots
      return singles.sort(
        (a, b) => a.interval.start.getTime() - b.interval.start.getTime(),
      )[0];
    }

    // Among combos, prefer fewer tables, then earlier slots
    if (combos.length > 0) {
      return combos.sort((a, b) => {
        // First by number of tables (fewer is better)
        const tableCountDiff = a.tableIds.length - b.tableIds.length;
        if (tableCountDiff !== 0) {
          return tableCountDiff;
        }
        // Then by start time (earlier is better)
        return a.interval.start.getTime() - b.interval.start.getTime();
      })[0];
    }

    return null;
  }
}
