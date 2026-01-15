import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { SeedService } from '../../src/woki/infrastructure/persistence/seed.service';
import { DataSource } from 'typeorm';
import { IdempotencyService } from '../../src/woki/infrastructure/idempotency/idempotency.service';
import { LockManagerService } from '../../src/woki/infrastructure/locking/lock-manager.service';

describe('WokiBrain Blackout API (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let seedService: SeedService;
  let idempotencyService: IdempotencyService;
  let lockManagerService: LockManagerService;

  beforeAll(async () => {
    // Use a separate test database per test suite to avoid conflicts when running in parallel
    process.env.DATABASE_PATH = 'woki-test-blackouts.db';
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

    // Clean blackouts table before each test
    if (dataSource && dataSource.isInitialized) {
      try {
        await dataSource.query(`DELETE FROM blackouts`);
      } catch {
        // Table might not exist yet, ignore
      }
    }

    // Clean bookings table before each test (keep seeded booking B1)
    if (dataSource && dataSource.isInitialized) {
      try {
        await dataSource.query(`DELETE FROM bookings WHERE id != 'B1'`);
      } catch {
        // Table might not exist yet, ignore
      }
    }
  });

  describe('1. Create Blackout', () => {
    it('should create a table-specific blackout', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: ['T1'],
          // Restaurant is America/Argentina/Buenos_Aires (UTC-3). Local 20:00–22:00 = 23:00Z–01:00Z.
          start: '2025-10-22T23:00:00Z',
          end: '2025-10-23T01:00:00Z',
          reason: 'MAINTENANCE',
          notes: 'Table repair',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        restaurantId: 'R1',
        sectorId: 'S1',
        tableIds: ['T1'],
        reason: 'MAINTENANCE',
        notes: 'Table repair',
      });
      expect(response.body.id).toBeDefined();
      expect(response.body.start).toBeDefined();
      expect(response.body.end).toBeDefined();
    });

    it('should create a sector-wide blackout', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: [],
          // Local 18:00–20:00 = 21:00Z–23:00Z
          start: '2025-10-22T21:00:00Z',
          end: '2025-10-22T23:00:00Z',
          reason: 'PRIVATE_EVENT',
          notes: 'Private party',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        restaurantId: 'R1',
        sectorId: 'S1',
        tableIds: [],
        reason: 'PRIVATE_EVENT',
        notes: 'Private party',
      });
    });

    it('should create a blackout for multiple tables', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: ['T1', 'T2', 'T3'],
          // Local 20:00–22:00 = 23:00Z–01:00Z
          start: '2025-10-22T23:00:00Z',
          end: '2025-10-23T01:00:00Z',
          reason: 'MAINTENANCE',
        })
        .expect(201);

      expect(response.body.tableIds).toHaveLength(3);
      expect(response.body.tableIds).toContain('T1');
      expect(response.body.tableIds).toContain('T2');
      expect(response.body.tableIds).toContain('T3');
    });

    it('should return 404 for non-existent restaurant', async () => {
      await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R999',
          sectorId: 'S1',
          tableIds: ['T1'],
          start: '2025-10-22T20:00:00Z',
          end: '2025-10-22T22:00:00Z',
          reason: 'MAINTENANCE',
        })
        .expect(404)
        .expect((res) => {
          expect(res.body.error).toBe('not_found');
        });
    });

    it('should return 404 for non-existent sector', async () => {
      await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S999',
          tableIds: ['T1'],
          start: '2025-10-22T20:00:00Z',
          end: '2025-10-22T22:00:00Z',
          reason: 'MAINTENANCE',
        })
        .expect(404)
        .expect((res) => {
          expect(res.body.error).toBe('not_found');
        });
    });

    it('should return 404 for non-existent table', async () => {
      await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: ['T999'],
          start: '2025-10-22T20:00:00Z',
          end: '2025-10-22T22:00:00Z',
          reason: 'MAINTENANCE',
        })
        .expect(404)
        .expect((res) => {
          expect(res.body.error).toBe('not_found');
        });
    });

    it('should return 400 for invalid date format', async () => {
      await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: ['T1'],
          start: 'invalid-date',
          end: '2025-10-22T22:00:00Z',
          reason: 'MAINTENANCE',
        })
        .expect(400);
    });

    it('should return 400 when start >= end', async () => {
      await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: ['T1'],
          start: '2025-10-22T22:00:00Z',
          end: '2025-10-22T20:00:00Z',
          reason: 'MAINTENANCE',
        })
        .expect(400);
    });

    it('should return 400 for invalid reason', async () => {
      await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: ['T1'],
          start: '2025-10-22T20:00:00Z',
          end: '2025-10-22T22:00:00Z',
          reason: 'INVALID_REASON',
        })
        .expect(400);
    });
  });

  describe('2. List Blackouts', () => {
    it('should return blackouts for a given date', async () => {
      // Create a blackout first
      await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: ['T1'],
          start: '2025-10-22T23:00:00Z',
          end: '2025-10-23T01:00:00Z',
          reason: 'MAINTENANCE',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/api/woki/blackouts')
        .query({
          restaurantId: 'R1',
          sectorId: 'S1',
          date: '2025-10-22',
        })
        .expect(200);

      expect(response.body).toHaveProperty('date');
      expect(response.body).toHaveProperty('items');
      expect(Array.isArray(response.body.items)).toBe(true);
      expect(response.body.items.length).toBeGreaterThan(0);
      expect(response.body.items[0]).toHaveProperty('id');
      expect(response.body.items[0]).toHaveProperty('tableIds');
      expect(response.body.items[0]).toHaveProperty('reason');
    });

    it('should return empty list for date with no blackouts', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/woki/blackouts')
        .query({
          restaurantId: 'R1',
          sectorId: 'S1',
          date: '2025-10-23', // Different date
        })
        .expect(200);

      expect(response.body.items).toEqual([]);
    });

    it('should return 404 for non-existent restaurant', async () => {
      await request(app.getHttpServer())
        .get('/api/woki/blackouts')
        .query({
          restaurantId: 'R999',
          sectorId: 'S1',
          date: '2025-10-22',
        })
        .expect(404);
    });

    it('should return 404 for non-existent sector', async () => {
      await request(app.getHttpServer())
        .get('/api/woki/blackouts')
        .query({
          restaurantId: 'R1',
          sectorId: 'S999',
          date: '2025-10-22',
        })
        .expect(404);
    });
  });

  describe('3. Delete Blackout', () => {
    it('should delete a blackout', async () => {
      // Create a blackout first
      const createResponse = await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: ['T1'],
          start: '2025-10-22T23:00:00Z',
          end: '2025-10-23T01:00:00Z',
          reason: 'MAINTENANCE',
        })
        .expect(201);

      const blackoutId = createResponse.body.id;

      // Delete the blackout
      await request(app.getHttpServer())
        .delete(`/api/woki/blackouts/${blackoutId}`)
        .expect(204);

      // Verify it's deleted by trying to list
      const listResponse = await request(app.getHttpServer())
        .get('/api/woki/blackouts')
        .query({
          restaurantId: 'R1',
          sectorId: 'S1',
          date: '2025-10-22',
        })
        .expect(200);

      const deletedBlackout = listResponse.body.items.find(
        (b: any) => b.id === blackoutId,
      );
      expect(deletedBlackout).toBeUndefined();
    });

    it('should return 404 for non-existent blackout', async () => {
      await request(app.getHttpServer())
        .delete('/api/woki/blackouts/BLK_NOTFOUND')
        .expect(404);
    });
  });

  describe('4. Blackout Blocks Availability', () => {
    it('should prevent booking during table-specific blackout', async () => {
      // Create a blackout for T1 from 20:00 to 22:00
      await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: ['T1'],
          start: '2025-10-22T23:00:00Z',
          end: '2025-10-23T01:00:00Z',
          reason: 'MAINTENANCE',
        })
        .expect(201);

      // Create a booking during the blackout window.
      // The system should still be able to book (other tables exist),
      // but it must not assign T1.
      const bookingRes = await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', `test-blackout-t1-${Date.now()}`)
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 2,
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '20:00',
          windowEnd: '22:00',
        })
        .expect(201);

      expect(bookingRes.body.tableIds).toBeDefined();
      expect(Array.isArray(bookingRes.body.tableIds)).toBe(true);
      expect(bookingRes.body.tableIds).not.toContain('T1');
    });

    it('should prevent booking during sector-wide blackout', async () => {
      // Create a sector-wide blackout
      await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: [],
          start: '2025-10-22T23:00:00Z',
          end: '2025-10-23T01:00:00Z',
          reason: 'PRIVATE_EVENT',
        })
        .expect(201);

      // Try to book any table during the blackout period
      await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', `test-blackout-sector-${Date.now()}`)
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 2,
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '20:00',
          windowEnd: '22:00',
        })
        .expect(409)
        .expect((res) => {
          expect(res.body.error).toBe('no_capacity');
        });
    });

    it('should allow booking outside blackout period', async () => {
      // Create a blackout from 20:00 to 22:00
      await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: ['T1'],
          start: '2025-10-22T23:00:00Z',
          end: '2025-10-23T01:00:00Z',
          reason: 'MAINTENANCE',
        })
        .expect(201);

      // Book T1 before the blackout (using lunch window)
      await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', `test-blackout-outside-${Date.now()}`)
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
    });

    it('should exclude blackout periods from discover candidates', async () => {
      // Create a blackout for T1 from 20:00 to 22:00
      await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: ['T1'],
          start: '2025-10-22T23:00:00Z',
          end: '2025-10-23T01:00:00Z',
          reason: 'MAINTENANCE',
        })
        .expect(201);

      // Discover candidates - should not include T1 during blackout period
      const response = await request(app.getHttpServer())
        .get('/api/woki/discover')
        .query({
          restaurantId: 'R1',
          sectorId: 'S1',
          date: '2025-10-22',
          partySize: 2,
          duration: 60,
          windowStart: '20:00',
          windowEnd: '22:00',
        })
        .expect(200);

      // Check that no candidates include T1 during the blackout period
      const t1Candidates = response.body.candidates.filter((c: any) =>
        c.tableIds.includes('T1'),
      );
      expect(t1Candidates.length).toBe(0);
    });
  });

  describe('5. Blackout Edge Cases', () => {
    it('should handle blackout that overlaps with existing booking', async () => {
      // Create a booking first
      const bookingResponse = await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', `test-blackout-overlap-${Date.now()}`)
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 2,
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '21:30',
          windowEnd: '23:45',
        })
        .expect(201);

      const bookedTable = bookingResponse.body.tableIds[0];

      // Create a blackout that overlaps with the booking
      // This should be allowed (blackouts can be created even if they overlap bookings)
      await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: [bookedTable],
          // Local 22:00–23:00 = 01:00Z–02:00Z next day
          start: '2025-10-23T01:00:00Z',
          end: '2025-10-23T02:00:00Z',
          reason: 'MAINTENANCE',
        })
        .expect(201);
    });

    it('should handle multiple blackouts on same table', async () => {
      // Create first blackout
      await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: ['T1'],
          // Local 20:00–21:00 = 23:00Z–00:00Z
          start: '2025-10-22T23:00:00Z',
          end: '2025-10-23T00:00:00Z',
          reason: 'MAINTENANCE',
        })
        .expect(201);

      // Create second blackout on same table
      await request(app.getHttpServer())
        .post('/api/woki/blackouts')
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: ['T1'],
          // Local 22:00–23:00 = 01:00Z–02:00Z
          start: '2025-10-23T01:00:00Z',
          end: '2025-10-23T02:00:00Z',
          reason: 'MAINTENANCE',
        })
        .expect(201);

      // Both blackouts should be listed
      const response = await request(app.getHttpServer())
        .get('/api/woki/blackouts')
        .query({
          restaurantId: 'R1',
          sectorId: 'S1',
          date: '2025-10-22',
        })
        .expect(200);

      const t1Blackouts = response.body.items.filter((b: any) =>
        b.tableIds.includes('T1'),
      );
      expect(t1Blackouts.length).toBe(2);
    });
  });
});
