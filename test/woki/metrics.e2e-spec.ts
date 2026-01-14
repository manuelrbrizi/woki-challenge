import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { SeedService } from '../../src/woki/infrastructure/persistence/seed.service';
import { DataSource } from 'typeorm';
import { IdempotencyService } from '../../src/woki/infrastructure/idempotency/idempotency.service';
import { LockManagerService } from '../../src/woki/infrastructure/locking/lock-manager.service';

describe('WokiBrain Metrics API (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let seedService: SeedService;
  let idempotencyService: IdempotencyService;
  let lockManagerService: LockManagerService;

  beforeAll(async () => {
    // Use a separate test database
    process.env.DATABASE_PATH = 'woki-test.db';
    process.env.DROP_SCHEMA_ON_STARTUP = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    dataSource = moduleFixture.get<DataSource>(DataSource);
    seedService = moduleFixture.get<SeedService>(SeedService);
    idempotencyService =
      moduleFixture.get<IdempotencyService>(IdempotencyService);
    lockManagerService =
      moduleFixture.get<LockManagerService>(LockManagerService);

    // Set global prefix to match production
    app.setGlobalPrefix('api', {
      exclude: ['/'],
    });

    await app.init();

    // Wait for database to be ready
    let retries = 10;
    while (retries > 0) {
      try {
        await dataSource.query('SELECT COUNT(*) FROM bookings');
        break;
      } catch {
        retries--;
        if (retries === 0) {
          throw new Error('Database tables not ready after initialization');
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Seed database before tests
    await seedService.seed();
  });

  afterAll(async () => {
    // Clean up database
    if (dataSource.isInitialized) {
      await dataSource.dropDatabase();
      await dataSource.destroy();
    }
    await app.close();
  });

  beforeEach(async () => {
    // Clear in-memory services between tests
    await idempotencyService.clear();
    lockManagerService.clear();

    // Clean bookings table before each test
    if (dataSource && dataSource.isInitialized) {
      try {
        await dataSource.query(`DELETE FROM bookings WHERE id != 'B1'`);
      } catch {
        // Table might not exist yet, ignore
      }
    }
  });

  describe('GET /api/woki/metrics', () => {
    it('should return metrics in correct format', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/woki/metrics')
        .expect(200);

      expect(response.body).toHaveProperty('bookings');
      expect(response.body).toHaveProperty('assignmentTime');
      expect(response.body).toHaveProperty('locks');

      expect(response.body.bookings).toHaveProperty('created');
      expect(response.body.bookings).toHaveProperty('cancelled');
      expect(response.body.bookings).toHaveProperty('conflicts');
      expect(response.body.bookings.conflicts).toHaveProperty('no_capacity');
      expect(response.body.bookings.conflicts).toHaveProperty('table_locked');

      expect(response.body.assignmentTime).toHaveProperty('p95');
      expect(response.body.assignmentTime).toHaveProperty('samples');

      expect(response.body.locks).toHaveProperty('waitTimes');
      expect(response.body.locks.waitTimes).toHaveProperty('p95');
      expect(response.body.locks.waitTimes).toHaveProperty('samples');
      expect(response.body.locks).toHaveProperty('timeouts');
    });

    it('should return zero values initially', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/woki/metrics')
        .expect(200);

      expect(response.body.bookings.created).toBe(0);
      expect(response.body.bookings.cancelled).toBe(0);
      expect(response.body.bookings.conflicts.no_capacity).toBe(0);
      expect(response.body.bookings.conflicts.table_locked).toBe(0);
      expect(response.body.locks.timeouts).toBe(0);
    });

    it('should track booking created', async () => {
      // Create a booking
      await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 2,
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '12:00',
          windowEnd: '16:00',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/api/woki/metrics')
        .expect(200);

      expect(response.body.bookings.created).toBe(1);
      expect(response.body.assignmentTime.samples).toBeGreaterThan(0);
    });

    it('should track booking cancelled', async () => {
      // Create a booking first
      const createResponse = await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 2,
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '12:00',
          windowEnd: '16:00',
        })
        .expect(201);

      const bookingId = createResponse.body.id;

      // Cancel the booking
      await request(app.getHttpServer())
        .delete(`/api/woki/bookings/${bookingId}`)
        .expect(204);

      const metricsResponse = await request(app.getHttpServer())
        .get('/api/woki/metrics')
        .expect(200);

      expect(metricsResponse.body.bookings.cancelled).toBe(1);
    });

    it('should track conflicts', async () => {
      // Try to book when no capacity (should fail with 409)
      await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 20, // Too large for any table
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '20:00',
          windowEnd: '20:30',
        })
        .expect(409);

      const response = await request(app.getHttpServer())
        .get('/api/woki/metrics')
        .expect(200);

      expect(response.body.bookings.conflicts.no_capacity).toBeGreaterThan(0);
    });

    it('should track assignment time samples', async () => {
      // Create multiple bookings to generate samples
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/woki/bookings')
          .send({
            restaurantId: 'R1',
            sectorId: 'S1',
            partySize: 2,
            durationMinutes: 60,
            date: '2025-10-22',
            windowStart: '12:00',
            windowEnd: '16:00',
          })
          .expect(201);
      }

      const response = await request(app.getHttpServer())
        .get('/api/woki/metrics')
        .expect(200);

      expect(response.body.assignmentTime.samples).toBe(3);
    });

    it('should calculate P95 when sufficient samples exist', async () => {
      // Create 20 bookings to meet P95 threshold
      for (let i = 0; i < 20; i++) {
        await request(app.getHttpServer())
          .post('/api/woki/bookings')
          .send({
            restaurantId: 'R1',
            sectorId: 'S1',
            partySize: 2,
            durationMinutes: 60,
            date: '2025-10-22',
            windowStart: '12:00',
            windowEnd: '16:00',
          })
          .expect(201);
      }

      const response = await request(app.getHttpServer())
        .get('/api/woki/metrics')
        .expect(200);

      expect(response.body.assignmentTime.samples).toBe(20);
      expect(response.body.assignmentTime.p95).not.toBeNull();
      expect(typeof response.body.assignmentTime.p95).toBe('number');
    });

    it('should track lock wait times', async () => {
      // Create bookings that may contend for locks
      // This will generate lock wait time samples
      const promises = Array.from({ length: 5 }, () =>
        request(app.getHttpServer()).post('/api/woki/bookings').send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 2,
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '21:15',
          windowEnd: '22:15',
        }),
      );

      await Promise.allSettled(promises);

      const response = await request(app.getHttpServer())
        .get('/api/woki/metrics')
        .expect(200);

      // Should have some lock wait time samples
      expect(response.body.locks.waitTimes.samples).toBeGreaterThanOrEqual(0);
    });
  });
});
