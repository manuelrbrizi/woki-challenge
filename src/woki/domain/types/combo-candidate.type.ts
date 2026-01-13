import { TimeInterval } from './time-interval.type';

export interface ComboCandidate {
  tableIds: string[];
  minCapacity: number;
  maxCapacity: number;
  interval: TimeInterval;
  kind: 'single' | 'combo';
}

