import { Test, TestingModule } from '@nestjs/testing';
import { LockManagerService } from './lock-manager.service';

describe('LockManagerService', () => {
  let service: LockManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LockManagerService],
    }).compile();

    service = module.get<LockManagerService>(LockManagerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('lock acquisition and release', () => {
    it('should acquire and release a lock', async () => {
      const lockKey = 'test-lock-1';

      const lockResult = await service.acquire(lockKey);
      expect(lockResult).toBeDefined();
      expect(lockResult.release).toBeDefined();
      expect(typeof lockResult.release).toBe('function');
      expect(lockResult.waitTimeMs).toBe(0); // No wait on first acquisition

      // Release the lock
      lockResult.release();

      // Should be able to acquire again immediately
      const lockResult2 = await service.acquire(lockKey);
      expect(lockResult2).toBeDefined();
      expect(lockResult2.waitTimeMs).toBe(0);
      lockResult2.release();
    });

    it('should block concurrent access to the same lock', async () => {
      const lockKey = 'test-lock-2';
      const executionOrder: string[] = [];

      // Acquire first lock
      const lockResult1 = await service.acquire(lockKey);
      executionOrder.push('lock1-acquired');

      // Try to acquire same lock (should wait)
      const lock2Promise = service.acquire(lockKey).then((lockResult2) => {
        executionOrder.push('lock2-acquired');
        expect(lockResult2.waitTimeMs).toBeGreaterThan(0); // Should have waited
        lockResult2.release();
      });

      // Give it a moment to start waiting
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionOrder.push('lock2-waiting');

      // Release first lock
      lockResult1.release();
      executionOrder.push('lock1-released');

      // Wait for second lock to be acquired
      await lock2Promise;

      // Verify execution order
      expect(executionOrder).toEqual([
        'lock1-acquired',
        'lock2-waiting',
        'lock1-released',
        'lock2-acquired',
      ]);
    });

    it('should handle multiple different locks independently', async () => {
      const lockKey1 = 'lock-1';
      const lockKey2 = 'lock-2';

      // Both should be acquirable simultaneously
      const lockResult1 = await service.acquire(lockKey1);
      const lockResult2 = await service.acquire(lockKey2);

      expect(lockResult1).toBeDefined();
      expect(lockResult2).toBeDefined();
      expect(lockResult1.waitTimeMs).toBe(0);
      expect(lockResult2.waitTimeMs).toBe(0);

      lockResult1.release();
      lockResult2.release();
    });

    it('should timeout if lock is held too long', async () => {
      const lockKey = 'test-lock-timeout';
      const shortTimeout = 100; // 100ms timeout

      // Acquire first lock
      const lockResult1 = await service.acquire(lockKey);

      // Try to acquire with short timeout (should fail)
      const lock2Promise = service.acquire(lockKey, shortTimeout);

      await expect(lock2Promise).rejects.toThrow('Lock timeout');

      // Clean up
      lockResult1.release();
    });

    it('should allow sequential locks on the same key', async () => {
      const lockKey = 'sequential-lock';

      // First lock
      const lockResult1 = await service.acquire(lockKey);
      lockResult1.release();

      // Second lock (should work immediately)
      const lockResult2 = await service.acquire(lockKey);
      expect(lockResult2.waitTimeMs).toBe(0);
      lockResult2.release();

      // Third lock (should work immediately)
      const lockResult3 = await service.acquire(lockKey);
      expect(lockResult3.waitTimeMs).toBe(0);
      lockResult3.release();
    });

    it('should handle multiple waiters on the same lock', async () => {
      const lockKey = 'multi-waiter-lock';
      const executionOrder: string[] = [];

      // Acquire first lock
      const lockResult1 = await service.acquire(lockKey);
      executionOrder.push('lock1-acquired');

      // Create multiple waiters
      const waiter2 = service.acquire(lockKey).then((lockResult) => {
        executionOrder.push('lock2-acquired');
        expect(lockResult.waitTimeMs).toBeGreaterThan(0);
        lockResult.release();
      });

      const waiter3 = service.acquire(lockKey).then((lockResult) => {
        executionOrder.push('lock3-acquired');
        expect(lockResult.waitTimeMs).toBeGreaterThan(0);
        lockResult.release();
      });

      // Give waiters time to start
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionOrder.push('waiters-started');

      // Release first lock
      lockResult1.release();
      executionOrder.push('lock1-released');

      // Wait for all waiters
      await Promise.all([waiter2, waiter3]);

      // Verify order: lock2 should acquire before lock3
      expect(executionOrder).toContain('lock1-acquired');
      expect(executionOrder).toContain('lock1-released');
      expect(executionOrder).toContain('lock2-acquired');
      expect(executionOrder).toContain('lock3-acquired');

      // lock2 should come before lock3
      const lock2Index = executionOrder.indexOf('lock2-acquired');
      const lock3Index = executionOrder.indexOf('lock3-acquired');
      expect(lock2Index).toBeLessThan(lock3Index);
    });
  });
});
