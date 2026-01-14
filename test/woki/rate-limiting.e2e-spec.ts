import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { SeedService } from '../../src/woki/infrastructure/persistence/seed.service';
import { DataSource } from 'typeorm';

describe('Rate Limiting (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let seedService: SeedService;

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
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Seed data
    await seedService.seed();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET endpoints rate limiting', () => {
    it('should allow 100 requests per minute for GET /api/woki/discover', async () => {
      const requests = Array.from({ length: 100 }, () =>
        request(app.getHttpServer()).get('/api/woki/discover').query({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 4,
          date: '2025-10-22',
          duration: 90,
        }),
      );

      const responses = await Promise.all(requests);
      // All 100 requests should succeed
      responses.forEach((response) => {
        expect([200, 409]).toContain(response.status);
      });
    });

    it('should return 429 after exceeding limit for GET /api/woki/discover', async () => {
      // Make 101 requests
      const requests = Array.from({ length: 101 }, () =>
        request(app.getHttpServer()).get('/api/woki/discover').query({
          restaurantId: 'R1',
          sectorId: 'S1',
          partySize: 4,
          date: '2025-10-22',
          duration: 90,
        }),
      );

      const responses = await Promise.all(requests);
      // At least one should be 429
      const rateLimited = responses.filter((r) => r.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);

      // Check error format
      if (rateLimited.length > 0) {
        expect(rateLimited[0].body).toEqual({
          error: 'rate_limited',
          detail: 'Too many requests',
        });
      }
    });
  });

  describe('POST endpoints rate limiting', () => {
    it('should allow 5 requests per minute for POST /api/woki/bookings', async () => {
      const payload = {
        restaurantId: 'R1',
        sectorId: 'S1',
        partySize: 4,
        date: '2025-10-22',
        durationMinutes: 90,
        windowStart: '19:00',
        windowEnd: '22:00',
      };

      const requests = Array.from({ length: 5 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/woki/bookings')
          .send(payload)
          .set('idempotency-key', `test-key-${i}`),
      );

      const responses = await Promise.all(requests);
      // All 5 requests should succeed (some may be 409 if no capacity, but not 429)
      responses.forEach((response) => {
        expect([201, 409]).toContain(response.status);
        expect(response.status).not.toBe(429);
      });
    });

    it('should return 429 after exceeding limit for POST /api/woki/bookings', async () => {
      const payload = {
        restaurantId: 'R1',
        sectorId: 'S1',
        partySize: 4,
        date: '2025-10-22',
        durationMinutes: 90,
        windowStart: '19:00',
        windowEnd: '22:00',
      };

      // Make 6 requests
      const requests = Array.from({ length: 6 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/woki/bookings')
          .send(payload)
          .set('idempotency-key', `test-key-limit-${i}`),
      );

      const responses = await Promise.all(requests);
      // At least one should be 429
      const rateLimited = responses.filter((r) => r.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);

      // Check error format
      if (rateLimited.length > 0) {
        expect(rateLimited[0].body).toEqual({
          error: 'rate_limited',
          detail: 'Too many requests',
        });
      }
    });
  });

  describe('DELETE endpoints rate limiting', () => {
    it('should allow 5 requests per minute for DELETE /api/woki/bookings/:id', async () => {
      // First create a booking to delete
      const createPayload = {
        restaurantId: 'R1',
        sectorId: 'S1',
        partySize: 2,
        date: '2025-10-22',
        durationMinutes: 60,
        windowStart: '19:00',
        windowEnd: '22:00',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/woki/bookings')
        .send(createPayload)
        .set('idempotency-key', 'delete-test-key');

      if (createResponse.status === 201) {
        const bookingId = createResponse.body.id;

        // Make 5 delete requests (only first will succeed, others will be 404)
        const requests = Array.from({ length: 5 }, () =>
          request(app.getHttpServer()).delete(
            `/api/woki/bookings/${bookingId}`,
          ),
        );

        const responses = await Promise.all(requests);
        // All should not be 429
        responses.forEach((response) => {
          expect(response.status).not.toBe(429);
        });
      }
    });
  });
});
