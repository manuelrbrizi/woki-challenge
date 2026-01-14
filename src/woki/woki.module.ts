import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { Restaurant } from './domain/entities/restaurant.entity';
import { Sector } from './domain/entities/sector.entity';
import { Table } from './domain/entities/table.entity';
import { Booking } from './domain/entities/booking.entity';
import { Blackout } from './domain/entities/blackout.entity';
import { ServiceWindow } from './domain/entities/service-window.entity';
import { Idempotency } from './domain/entities/idempotency.entity';
import { RestaurantRepository } from './infrastructure/persistence/repositories/restaurant.repository';
import { SectorRepository } from './infrastructure/persistence/repositories/sector.repository';
import { TableRepository } from './infrastructure/persistence/repositories/table.repository';
import { BookingRepository } from './infrastructure/persistence/repositories/booking.repository';
import { BlackoutRepository } from './infrastructure/persistence/repositories/blackout.repository';
import { ServiceWindowRepository } from './infrastructure/persistence/repositories/service-window.repository';
import { IdempotencyRepository } from './infrastructure/persistence/repositories/idempotency.repository';
import { ThrottlerExceptionFilter } from './infrastructure/rate-limiting/throttler-exception.filter';
import { SeedService } from './infrastructure/persistence/seed.service';
import { GapDiscoveryService } from './domain/services/gap-discovery.service';
import { ComboCalculatorService } from './domain/services/combo-calculator.service';
import { WokiBrainSelectorService } from './domain/services/wokibrain-selector.service';
import { LockManagerService } from './infrastructure/locking/lock-manager.service';
import { IdempotencyService } from './infrastructure/idempotency/idempotency.service';
import { LoggerService } from './infrastructure/logging/logger.service';
import { MetricsService } from './infrastructure/metrics/metrics.service';
import { BookingQueryService } from './application/services/booking-query.service';
import { BookingCommandService } from './application/services/booking-command.service';
import { BlackoutQueryService } from './application/services/blackout-query.service';
import { BlackoutCommandService } from './application/services/blackout-command.service';
import { WokiController } from './infrastructure/http/woki.controller';
import {
  RESTAURANT_REPOSITORY,
  SECTOR_REPOSITORY,
  TABLE_REPOSITORY,
  BOOKING_REPOSITORY,
  BLACKOUT_REPOSITORY,
  SERVICE_WINDOW_REPOSITORY,
  IDEMPOTENCY_REPOSITORY,
} from './tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Restaurant,
      Sector,
      Table,
      Booking,
      Blackout,
      ServiceWindow,
      Idempotency,
    ]),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60,
          limit: process.env.NODE_ENV === 'test' ? 10000 : 100, // Much higher limit in test (overridden by @Throttle decorators)
        },
      ],
    }),
  ],
  controllers: [WokiController],
  providers: [
    // Domain services
    GapDiscoveryService,
    ComboCalculatorService,
    WokiBrainSelectorService,
    // Infrastructure services
    LockManagerService,
    IdempotencyService,
    LoggerService,
    MetricsService,
    SeedService,
    // Repositories (implementations)
    RestaurantRepository,
    SectorRepository,
    TableRepository,
    BookingRepository,
    BlackoutRepository,
    ServiceWindowRepository,
    IdempotencyRepository,
    // Repository interfaces (provide tokens, use implementations)
    {
      provide: RESTAURANT_REPOSITORY,
      useClass: RestaurantRepository,
    },
    {
      provide: SECTOR_REPOSITORY,
      useClass: SectorRepository,
    },
    {
      provide: TABLE_REPOSITORY,
      useClass: TableRepository,
    },
    {
      provide: BOOKING_REPOSITORY,
      useClass: BookingRepository,
    },
    {
      provide: BLACKOUT_REPOSITORY,
      useClass: BlackoutRepository,
    },
    {
      provide: SERVICE_WINDOW_REPOSITORY,
      useClass: ServiceWindowRepository,
    },
    {
      provide: IDEMPOTENCY_REPOSITORY,
      useClass: IdempotencyRepository,
    },
    // Application services
    BookingQueryService,
    BookingCommandService,
    BlackoutQueryService,
    BlackoutCommandService,
    // Rate limiting
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: ThrottlerExceptionFilter,
    },
  ],
  exports: [SeedService],
})
export class WokiModule {}
