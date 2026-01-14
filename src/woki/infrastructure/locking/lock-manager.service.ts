import { Injectable } from '@nestjs/common';

interface Lock {
  promise: Promise<void>;
  resolve: () => void;
}

@Injectable()
export class LockManagerService {
  private locks = new Map<string, Lock>();

  /**
   * Acquire a lock for the given key.
   * Returns a function to release the lock.
   */
  async acquire(key: string, timeoutMs: number = 5000): Promise<() => void> {
    // Wait for existing lock if any
    while (this.locks.has(key)) {
      const existingLock = this.locks.get(key)!;
      try {
        await Promise.race([
          existingLock.promise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Lock timeout')), timeoutMs),
          ),
        ]);
      } catch (error) {
        // If it's a timeout error, rethrow it
        if (error instanceof Error && error.message === 'Lock timeout') {
          throw error;
        }
        // Otherwise, lock was released, continue
        break;
      }
    }

    // Create new lock
    let resolve: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });

    this.locks.set(key, { promise, resolve: resolve! });

    // Return release function
    return () => {
      const lock = this.locks.get(key);
      if (lock) {
        lock.resolve();
        this.locks.delete(key);
      }
    };
  }

  /**
   * Clear all locks (useful for testing)
   */
  clear(): void {
    // Resolve all pending locks before clearing
    for (const lock of this.locks.values()) {
      lock.resolve();
    }
    this.locks.clear();
  }
}
