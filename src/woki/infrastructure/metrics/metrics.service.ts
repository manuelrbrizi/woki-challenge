import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private bookingsCreated = 0;
  private bookingsCancelled = 0;
  private conflictsNoCapacity = 0;
  private conflictsTableLocked = 0;
  private lockTimeouts = 0;

  // Arrays to store timing measurements
  private assignmentTimes: number[] = [];
  private lockWaitTimes: number[] = [];

  // Maximum samples to keep in memory (circular buffer approach)
  private readonly MAX_SAMPLES = 1000;

  /**
   * Resets all in-memory counters and samples.
   * Intended for test isolation (e2e/units) since this service is stateful.
   */
  reset(): void {
    this.bookingsCreated = 0;
    this.bookingsCancelled = 0;
    this.conflictsNoCapacity = 0;
    this.conflictsTableLocked = 0;
    this.lockTimeouts = 0;
    this.assignmentTimes = [];
    this.lockWaitTimes = [];
  }

  recordBookingCreated(): void {
    this.bookingsCreated++;
  }

  recordBookingCancelled(): void {
    this.bookingsCancelled++;
  }

  recordConflict(type: 'no_capacity' | 'table_locked'): void {
    if (type === 'no_capacity') {
      this.conflictsNoCapacity++;
    } else if (type === 'table_locked') {
      this.conflictsTableLocked++;
    }
  }

  recordAssignmentTime(ms: number): void {
    this.addSample(this.assignmentTimes, ms);
  }

  recordLockWaitTime(ms: number): void {
    this.addSample(this.lockWaitTimes, ms);
  }

  recordLockTimeout(): void {
    this.lockTimeouts++;
  }

  getMetrics(): {
    bookings: {
      created: number;
      cancelled: number;
      conflicts: {
        no_capacity: number;
        table_locked: number;
      };
    };
    assignmentTime: {
      p95: number | null;
      samples: number;
    };
    locks: {
      waitTimes: {
        p95: number | null;
        samples: number;
      };
      timeouts: number;
    };
  } {
    return {
      bookings: {
        created: this.bookingsCreated,
        cancelled: this.bookingsCancelled,
        conflicts: {
          no_capacity: this.conflictsNoCapacity,
          table_locked: this.conflictsTableLocked,
        },
      },
      assignmentTime: {
        p95: this.calculateP95(this.assignmentTimes),
        samples: this.assignmentTimes.length,
      },
      locks: {
        waitTimes: {
          p95: this.calculateP95(this.lockWaitTimes),
          samples: this.lockWaitTimes.length,
        },
        timeouts: this.lockTimeouts,
      },
    };
  }

  private addSample(array: number[], value: number): void {
    array.push(value);
    // Keep only the last MAX_SAMPLES to prevent unbounded memory growth
    if (array.length > this.MAX_SAMPLES) {
      array.shift();
    }
  }

  private calculateP95(values: number[]): number | null {
    if (values.length < 20) {
      // Insufficient data for reliable P95
      return null;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[index];
  }
}
