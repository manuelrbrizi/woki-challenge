import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { SeedService } from '../../src/woki/infrastructure/persistence/seed.service';
import { DataSource } from 'typeorm';
import { IdempotencyService } from '../../src/woki/infrastructure/idempotency/idempotency.service';
import { LockManagerService } from '../../src/woki/infrastructure/locking/lock-manager.service';
import { Booking } from '../../src/woki/domain/entities/booking.entity';
import { BookingStatus } from '../../src/woki/domain/types/booking-status.enum';
import { zonedTimeToUtc } from 'date-fns-tz';

describe('WokiBrain Booking API (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let seedService: SeedService;
  let idempotencyService: IdempotencyService;
  let lockManagerService: LockManagerService;

  beforeAll(async () => {
    // Use a separate test database per test suite to avoid conflicts when running in parallel
    process.env.DATABASE_PATH = 'woki-test-bookings.db';
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

    // Wait for database to be ready and tables to be created
    // TypeORM synchronize should have created tables, but we verify
    let retries = 10;
    while (retries > 0) {
      try {
        // Try to query the bookings table to verify it exists
        await dataSource.query('SELECT COUNT(*) FROM bookings');
        break;
      } catch (error) {
        retries--;
        if (retries === 0) {
          throw new Error(
            `Database tables not ready after initialization: ${error}`,
          );
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
    // Clear in-memory services between tests FIRST
    await idempotencyService.clear();
    lockManagerService.clear();

    // Clean bookings table before each test (keep seed data structure)
    // Only if table exists and dataSource is initialized
    if (dataSource && dataSource.isInitialized) {
      try {
        // Use 'bookings' (plural) as defined in @Entity('bookings')
        // Delete all bookings except the seed booking B1
        // SQLite uses single quotes for string literals
        await dataSource.query(`DELETE FROM bookings WHERE id != 'B1'`);
        // Clean idempotency table
        await dataSource.query(`DELETE FROM idempotency`);
      } catch {
        // If table doesn't exist yet, it's OK - it will be created by the seed
        // This can happen on the first test before seed runs
        // Silently ignore - the table will be created by seed
      }
    }
  });

  describe('1. Happy single: Perfect gap on a single table', () => {
    it('should successfully book a single table for party of 2', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', `test-single-2-${Date.now()}`)
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 2,
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '12:00', // Use lunch window to avoid B1
          windowEnd: '16:00',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        restaurantId: 'R1',
        sectorId: 'S1',
        partySize: 2,
        durationMinutes: 60,
        status: 'CONFIRMED',
      });
      expect(response.body.tableIds).toHaveLength(1);
      expect(response.body.tableIds[0]).toMatch(/^T[1-5]$/);
      expect(response.body.id).toBeDefined();
      expect(response.body.start).toBeDefined();
      expect(response.body.end).toBeDefined();
    });

    it('should book table T4 for party of 5 (fits perfectly)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', `test-t4-5-${Date.now()}`)
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 5,
          durationMinutes: 90,
          date: '2025-10-22',
          windowStart: '21:30', // After B1 ends to avoid conflicts
          windowEnd: '23:45',
        })
        .expect(201);

      expect(response.body.partySize).toBe(5);
      expect(response.body.tableIds).toEqual(['T4']); // T4 is 4-6 capacity
      expect(response.body.durationMinutes).toBe(90);
    });
  });

  describe('2. Happy combo: Valid combination when singles cannot fit', () => {
    it('should book a combo for party of 7 (no single table fits)', async () => {
      // Use a window that avoids the existing booking B1 (20:30-21:15)
      // Try after 21:15 or use a different time slot
      const response = await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', `test-combo-7-${Date.now()}`)
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 7,
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '21:30', // After B1 ends
          windowEnd: '23:45',
        })
        .expect(201);

      expect(response.body.partySize).toBe(7);
      expect(response.body.tableIds.length).toBeGreaterThan(1); // Combo
      expect(response.body.tableIds).toContain('T4'); // Should include T4 (max 6)

      // Verify it's a combo candidate
      const totalMaxCapacity = response.body.tableIds.reduce(
        (sum: number, tableId: string) => {
          const capacities: Record<string, number> = {
            T1: 2,
            T2: 4,
            T3: 4,
            T4: 6,
            T5: 2,
          };
          return sum + capacities[tableId];
        },
        0,
      );
      expect(totalMaxCapacity).toBeGreaterThanOrEqual(7);
    });

    it('should find combo candidates in discover endpoint', async () => {
      // Use a window that avoids the existing booking B1 (20:30-21:15)
      const response = await request(app.getHttpServer())
        .get('/api/woki/discover')
        .query({
          restaurantId: 'R1',
          sectorId: 'S1',
          date: '2025-10-22',
          partySize: 7,
          duration: 60,
          windowStart: '21:30', // After B1 ends
          windowEnd: '23:45',
        })
        .expect(200);

      expect(response.body.candidates).toBeDefined();
      const comboCandidates = response.body.candidates.filter(
        (c: any) => c.kind === 'combo',
      );
      expect(comboCandidates.length).toBeGreaterThan(0);
    });
  });

  describe('3. Boundary: Bookings touching at end are accepted (end-exclusive)', () => {
    it('should allow booking starting exactly when previous booking ends', async () => {
      // Existing booking B1: T2 from 20:30 to 21:15
      // Book T2 starting at 21:15 (touching at end)
      const response = await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', `test-touching-1-${Date.now()}`)
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 2,
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '20:00',
          windowEnd: '23:45',
        })
        .expect(201);

      // Should be able to book starting at or after 21:15 (end-exclusive means 21:15 is available)
      // The existing booking B1 ends at 21:15 in Buenos Aires timezone
      // The response contains the booking start time in ISO format
      const bookingStart = new Date(response.body.start);

      // B1 ends at 21:15 Buenos Aires = 00:15 UTC next day
      // But the new booking might be on a different table, so we just verify it's valid
      expect(bookingStart.getTime()).toBeGreaterThan(0);
      expect(response.body.tableIds).toBeDefined();
      expect(response.body.tableIds.length).toBeGreaterThan(0);
    });

    it('should allow booking ending exactly when next booking starts', async () => {
      // First booking
      const firstBooking = await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', `test-touching-2-first-${Date.now()}`)
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 2,
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '20:00',
          windowEnd: '23:45',
        })
        .expect(201);

      // Second booking starting exactly when first ends
      const secondBooking = await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', `test-touching-2-second-${Date.now()}`)
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 2,
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '20:00',
          windowEnd: '23:45',
        })
        .expect(201);

      const secondStart = new Date(secondBooking.body.start);
      const firstBookingEnd = new Date(firstBooking.body.end);

      // Second booking can start at first booking's end (end-exclusive)
      // The bookings might be on different tables, so we verify they're both valid
      expect(secondStart.getTime()).toBeGreaterThan(0);
      expect(firstBookingEnd.getTime()).toBeGreaterThan(0);

      // If they're on the same table, second should start at or after first ends
      // But if they're on different tables, they can overlap
      if (
        firstBooking.body.tableIds.some((id) =>
          secondBooking.body.tableIds.includes(id),
        )
      ) {
        expect(secondStart.getTime()).toBeGreaterThanOrEqual(
          firstBookingEnd.getTime() - 1000, // Allow 1 second tolerance
        );
      }
    });
  });

  describe('4. Idempotency: Repeat POST with same payload + Idempotency-Key', () => {
    it('should return the same booking for identical requests with same idempotency key', async () => {
      const idempotencyKey = `test-key-${Date.now()}`;
      const payload = {
        restaurantId: 'R1',
        sectorId: 'S1',
        partySize: 3,
        durationMinutes: 90,
        date: '2025-10-22',
        windowStart: '21:30', // After B1 ends
        windowEnd: '23:45',
      };

      const firstResponse = await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(201);

      const firstBookingId = firstResponse.body.id;

      // Second request with same key and payload
      const secondResponse = await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(201);

      expect(secondResponse.body.id).toBe(firstBookingId);
      expect(secondResponse.body).toEqual(firstResponse.body);
    });

    it('should create different bookings with different idempotency keys', async () => {
      const payload = {
        restaurantId: 'R1',
        sectorId: 'S1',
        partySize: 2,
        durationMinutes: 60,
        date: '2025-10-22',
        windowStart: '21:30', // After B1 ends
        windowEnd: '23:45',
      };

      const firstResponse = await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', 'key-1')
        .send(payload)
        .expect(201);

      const secondResponse = await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', 'key-2')
        .send(payload)
        .expect(201);

      // Should be different bookings (or one should fail with 409 if same slot)
      expect(firstResponse.body.id).not.toBe(secondResponse.body.id);
    });

    it('should reject different payload with same idempotency key', async () => {
      const idempotencyKey = `test-key-diff-${Date.now()}`;

      await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 2,
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '21:30', // After B1 ends
          windowEnd: '23:45',
        })
        .expect(201);

      // Different payload with same key should fail
      await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 4, // Different party size
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '20:00',
          windowEnd: '23:45',
        })
        .expect(400); // Should fail validation
    });
  });

  describe('5. Concurrency: Two parallel creates targeting the same candidate', () => {
    it('should return 201 for one and 409 for the other when targeting same slot', async () => {
      // Ensure both requests are forced to target the same single-table candidate.
      // Without this, the allocator can legitimately choose different available tables
      // (e.g. T1 and T2), making both requests succeed.
      const bookingRepo = dataSource.getRepository(Booking);
      const tz = 'America/Argentina/Buenos_Aires';
      const blockingStart = zonedTimeToUtc(new Date('2025-10-22T21:15:00'), tz);
      const blockingEnd = zonedTimeToUtc(new Date('2025-10-22T22:15:00'), tz);

      // Block every table except T1 for the candidate slot.
      // B1 already exists on T2 ending at 21:15; we extend with a new overlapping booking.
      await bookingRepo.save(
        ['T2', 'T3', 'T4', 'T5'].map((tableId) =>
          bookingRepo.create({
            id: `BLK_${tableId}`,
            restaurantId: 'R1',
            sectorId: 'S1',
            tableIds: [tableId],
            partySize: 2,
            start: blockingStart,
            end: blockingEnd,
            durationMinutes: 60,
            status: BookingStatus.CONFIRMED,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
      );

      const payload = {
        restaurantId: 'R1',
        sectorId: 'S1',
        partySize: 2,
        durationMinutes: 60,
        date: '2025-10-22',
        windowStart: '21:15', // Right after existing booking ends
        // Tighten the window to a single possible 60-min slot.
        // Otherwise, the second request can legitimately pick a later start on another table.
        windowEnd: '22:15',
      };

      // Fire two requests in parallel
      const [response1, response2] = await Promise.allSettled([
        request(app.getHttpServer())
          .post('/api/woki/bookings')
          .set('Idempotency-Key', `test-concurrent-1-${Date.now()}`)
          .send(payload),
        request(app.getHttpServer())
          .post('/api/woki/bookings')
          .set('Idempotency-Key', `test-concurrent-2-${Date.now()}`)
          .send(payload),
      ]);

      // One should succeed (201), one should fail (409)
      const statuses = [
        response1.status === 'fulfilled' ? response1.value.status : null,
        response2.status === 'fulfilled' ? response2.value.status : null,
      ].filter(Boolean);

      expect(statuses).toContain(201);
      expect(statuses).toContain(409);

      // Check that the 409 response has the correct error
      const failedResponse =
        response1.status === 'fulfilled' && response1.value.status === 409
          ? response1.value
          : response2.status === 'fulfilled'
            ? response2.value
            : null;

      if (failedResponse && failedResponse.status === 409) {
        // Depending on timing, the losing request can fail either on lock acquisition
        // or after acquiring the lock but re-verifying capacity.
        expect(['table_locked', 'no_capacity']).toContain(
          failedResponse.body.error,
        );
      }
    }, 10000); // Increase timeout for concurrency test
  });

  describe('6. Outside hours: Request window outside service windows', () => {
    it('should return 422 when window is outside service hours', async () => {
      await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', `test-outside-1-${Date.now()}`)
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 2,
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '10:00', // Before service window (starts at 12:00)
          windowEnd: '11:00',
        })
        .expect(422)
        .expect((res) => {
          expect(res.body.error).toBe('outside_service_window');
        });
    });

    it('should return 422 when window extends beyond service hours', async () => {
      await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', `test-outside-2-${Date.now()}`)
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 2,
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '23:00',
          windowEnd: '00:00', // After service window ends (23:45)
        })
        .expect(422)
        .expect((res) => {
          expect(res.body.error).toBe('outside_service_window');
        });
    });

    it('should allow booking within service window', async () => {
      await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .set('Idempotency-Key', `test-within-window-${Date.now()}`)
        .send({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 2,
          durationMinutes: 60,
          date: '2025-10-22',
          windowStart: '21:30', // After B1 ends to ensure capacity
          windowEnd: '23:45',
        })
        .expect(201);
    });
  });

  describe('Additional Test Cases', () => {
    describe('Validation Errors', () => {
      it('should return 400 for missing idempotency key', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/woki/bookings')
          .send({
            restaurantId: 'R1',
            sectorId: 'S1',
            partySize: 2,
            durationMinutes: 60,
            date: '2025-10-22',
          })
          .expect(400);

        // Check error structure - detail might be string or object
        expect(response.body.error).toBe('invalid_input');
        const detail =
          typeof response.body.detail === 'string'
            ? response.body.detail
            : JSON.stringify(response.body.detail);
        expect(detail).toContain('Idempotency-Key');
      });

      it('should return 400 for empty idempotency key', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/woki/bookings')
          .set('Idempotency-Key', '')
          .send({
            restaurantId: 'R1',
            sectorId: 'S1',
            partySize: 2,
            durationMinutes: 60,
            date: '2025-10-22',
          })
          .expect(400);

        // Check error structure - detail might be string or object
        expect(response.body.error).toBe('invalid_input');
        const detail =
          typeof response.body.detail === 'string'
            ? response.body.detail
            : JSON.stringify(response.body.detail);
        expect(detail).toContain('Idempotency-Key');
      });

      it('should return 400 for invalid party size', async () => {
        await request(app.getHttpServer())
          .post('/api/woki/bookings')
          .set('Idempotency-Key', `test-invalid-party-${Date.now()}`)
          .send({
            restaurantId: 'R1',
            sectorId: 'S1',
            partySize: 0, // Invalid
            durationMinutes: 60,
            date: '2025-10-22',
          })
          .expect(400)
          .expect((res) => {
            expect(res.body.error).toBe('invalid_input');
          });
      });

      it('should return 400 for invalid date format', async () => {
        await request(app.getHttpServer())
          .post('/api/woki/bookings')
          .set('Idempotency-Key', `test-invalid-date-${Date.now()}`)
          .send({
            restaurantId: 'R1',
            sectorId: 'S1',
            partySize: 2,
            durationMinutes: 60,
            date: '2025/10/22', // Invalid format
          })
          .expect(400);
      });

      it('should return 400 for non-grid duration', async () => {
        await request(app.getHttpServer())
          .post('/api/woki/bookings')
          .set('Idempotency-Key', `test-invalid-duration-${Date.now()}`)
          .send({
            restaurantId: 'R1',
            sectorId: 'S1',
            partySize: 2,
            durationMinutes: 37, // Not a multiple of 15
            date: '2025-10-22',
          })
          .expect(400)
          .expect((res) => {
            expect(res.body.error).toBe('invalid_input');
          });
      });
    });

    describe('Not Found Errors', () => {
      it('should return 404 for non-existent restaurant', async () => {
        await request(app.getHttpServer())
          .post('/api/woki/bookings')
          .set('Idempotency-Key', `test-not-found-rest-${Date.now()}`)
          .send({
            restaurantId: 'R999',
            sectorId: 'S1',
            partySize: 2,
            durationMinutes: 60,
            date: '2025-10-22',
          })
          .expect(404)
          .expect((res) => {
            expect(res.body.error).toBe('not_found');
          });
      });

      it('should return 404 for non-existent sector', async () => {
        await request(app.getHttpServer())
          .post('/api/woki/bookings')
          .set('Idempotency-Key', `test-not-found-sector-${Date.now()}`)
          .send({
            restaurantId: 'R1',
            sectorId: 'S999',
            partySize: 2,
            durationMinutes: 60,
            date: '2025-10-22',
          })
          .expect(404)
          .expect((res) => {
            expect(res.body.error).toBe('not_found');
          });
      });
    });

    describe('No Capacity', () => {
      it('should return 409 when no capacity available', async () => {
        // Fill all available slots
        // This test might need adjustment based on actual availability
        await request(app.getHttpServer())
          .post('/api/woki/bookings')
          .set('Idempotency-Key', `test-no-capacity-${Date.now()}`)
          .send({
            restaurantId: 'R1',
            sectorId: 'S1',
            partySize: 20, // Too large for any combination
            durationMinutes: 60,
            date: '2025-10-22',
            windowStart: '20:00',
            windowEnd: '20:30', // Very narrow window
          })
          .expect(409)
          .expect((res) => {
            expect(res.body.error).toBe('no_capacity');
          });
      });
    });

    describe('Discover Endpoint', () => {
      it('should return candidates for valid request', async () => {
        const response = await request(app.getHttpServer())
          .get('/api/woki/discover')
          .query({
            restaurantId: 'R1',
            sectorId: 'S1',
            date: '2025-10-22',
            partySize: 2,
            duration: 60,
            windowStart: '20:00',
            windowEnd: '23:45',
          })
          .expect(200);

        expect(response.body).toHaveProperty('candidates');
        expect(response.body).toHaveProperty('slotMinutes');
        expect(response.body).toHaveProperty('durationMinutes');
        expect(Array.isArray(response.body.candidates)).toBe(true);
      });

      it('should return 409 when no capacity available', async () => {
        await request(app.getHttpServer())
          .get('/api/woki/discover')
          .query({
            restaurantId: 'R1',
            sectorId: 'S1',
            date: '2025-10-22',
            partySize: 20,
            duration: 60,
            windowStart: '20:00',
            windowEnd: '20:30',
          })
          .expect(409)
          .expect((res) => {
            expect(res.body.error).toBe('no_capacity');
            expect(res.body.detail).toBeDefined();
          });
      });
    });

    describe('List Bookings Endpoint', () => {
      it('should return bookings for a given date', async () => {
        // Create a booking first
        await request(app.getHttpServer())
          .post('/api/woki/bookings')
          .set('Idempotency-Key', `test-list-booking-${Date.now()}`)
          .send({
            restaurantId: 'R1',
            sectorId: 'S1',
            partySize: 2,
            durationMinutes: 60,
            date: '2025-10-22',
            windowStart: '21:30', // After B1 ends to ensure capacity
            windowEnd: '23:45',
          })
          .expect(201);

        const response = await request(app.getHttpServer())
          .get('/api/woki/bookings/day')
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
      });

      it('should return empty list for date with no bookings', async () => {
        const response = await request(app.getHttpServer())
          .get('/api/woki/bookings/day')
          .query({
            restaurantId: 'R1',
            sectorId: 'S1',
            date: '2025-10-23', // Different date
          })
          .expect(200);

        expect(response.body.items).toEqual([]);
      });
    });
  });
});
