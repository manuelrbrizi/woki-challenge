import { Test, TestingModule } from '@nestjs/testing';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsService],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('counters', () => {
    it('should track booking created', () => {
      service.recordBookingCreated();
      service.recordBookingCreated();

      const metrics = service.getMetrics();
      expect(metrics.bookings.created).toBe(2);
    });

    it('should track booking cancelled', () => {
      service.recordBookingCancelled();
      service.recordBookingCancelled();
      service.recordBookingCancelled();

      const metrics = service.getMetrics();
      expect(metrics.bookings.cancelled).toBe(3);
    });

    it('should track conflicts by type', () => {
      service.recordConflict('no_capacity');
      service.recordConflict('no_capacity');
      service.recordConflict('table_locked');

      const metrics = service.getMetrics();
      expect(metrics.bookings.conflicts.no_capacity).toBe(2);
      expect(metrics.bookings.conflicts.table_locked).toBe(1);
    });
  });

  describe('assignment time', () => {
    it('should track assignment times', () => {
      service.recordAssignmentTime(10);
      service.recordAssignmentTime(20);
      service.recordAssignmentTime(30);

      const metrics = service.getMetrics();
      expect(metrics.assignmentTime.samples).toBe(3);
    });

    it('should calculate P95 with sufficient samples', () => {
      // Add 20 samples to meet minimum threshold
      for (let i = 1; i <= 20; i++) {
        service.recordAssignmentTime(i * 10); // 10, 20, 30, ..., 200
      }

      const metrics = service.getMetrics();
      expect(metrics.assignmentTime.p95).toBe(190); // 95th percentile of 20 values
      expect(metrics.assignmentTime.samples).toBe(20);
    });

    it('should return null for P95 with insufficient samples', () => {
      // Add only 10 samples (below threshold of 20)
      for (let i = 1; i <= 10; i++) {
        service.recordAssignmentTime(i * 10);
      }

      const metrics = service.getMetrics();
      expect(metrics.assignmentTime.p95).toBeNull();
      expect(metrics.assignmentTime.samples).toBe(10);
    });

    it('should limit samples to MAX_SAMPLES', () => {
      // Add more than MAX_SAMPLES (1000)
      for (let i = 0; i < 1500; i++) {
        service.recordAssignmentTime(i);
      }

      const metrics = service.getMetrics();
      expect(metrics.assignmentTime.samples).toBe(1000);
    });
  });

  describe('lock statistics', () => {
    it('should track lock wait times', () => {
      service.recordLockWaitTime(5);
      service.recordLockWaitTime(10);
      service.recordLockWaitTime(15);

      const metrics = service.getMetrics();
      expect(metrics.locks.waitTimes.samples).toBe(3);
    });

    it('should calculate P95 for lock wait times', () => {
      // Add 20 samples
      for (let i = 1; i <= 20; i++) {
        service.recordLockWaitTime(i);
      }

      const metrics = service.getMetrics();
      expect(metrics.locks.waitTimes.p95).toBe(19);
      expect(metrics.locks.waitTimes.samples).toBe(20);
    });

    it('should track lock timeouts', () => {
      service.recordLockTimeout();
      service.recordLockTimeout();

      const metrics = service.getMetrics();
      expect(metrics.locks.timeouts).toBe(2);
    });
  });

  describe('getMetrics', () => {
    it('should return all metrics in correct format', () => {
      service.recordBookingCreated();
      service.recordBookingCancelled();
      service.recordConflict('no_capacity');
      service.recordConflict('table_locked');
      service.recordAssignmentTime(50);
      service.recordLockWaitTime(10);
      service.recordLockTimeout();

      const metrics = service.getMetrics();

      expect(metrics).toMatchObject({
        bookings: {
          created: 1,
          cancelled: 1,
          conflicts: {
            no_capacity: 1,
            table_locked: 1,
          },
        },
        assignmentTime: {
          samples: 1,
        },
        locks: {
          waitTimes: {
            samples: 1,
          },
          timeouts: 1,
        },
      });
    });

    it('should return zero values when no metrics recorded', () => {
      const metrics = service.getMetrics();

      expect(metrics.bookings.created).toBe(0);
      expect(metrics.bookings.cancelled).toBe(0);
      expect(metrics.bookings.conflicts.no_capacity).toBe(0);
      expect(metrics.bookings.conflicts.table_locked).toBe(0);
      expect(metrics.locks.timeouts).toBe(0);
    });
  });
});
