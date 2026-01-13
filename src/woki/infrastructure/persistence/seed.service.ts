import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Restaurant } from '../../domain/entities/restaurant.entity';
import { Sector } from '../../domain/entities/sector.entity';
import { Table } from '../../domain/entities/table.entity';
import { Booking } from '../../domain/entities/booking.entity';
import { ServiceWindow } from '../../domain/entities/service-window.entity';
import { BookingStatus } from '../../domain/types/booking-status.enum';
import { zonedTimeToUtc } from 'date-fns-tz';

@Injectable()
export class SeedService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    @InjectRepository(Sector)
    private readonly sectorRepository: Repository<Sector>,
    @InjectRepository(Table)
    private readonly tableRepository: Repository<Table>,
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(ServiceWindow)
    private readonly serviceWindowRepository: Repository<ServiceWindow>,
    private readonly dataSource: DataSource,
  ) {}

  async seed(): Promise<void> {
    // Check if data already exists
    const existingRestaurant = await this.restaurantRepository.findOne({
      where: { id: 'R1' },
    });

    if (existingRestaurant) {
      return; // Already seeded
    }

    // Use transaction for atomicity
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Create restaurant
      const restaurant = this.restaurantRepository.create({
        id: 'R1',
        name: 'Bistro Central',
        timezone: 'America/Argentina/Buenos_Aires',
        createdAt: zonedTimeToUtc(
          new Date('2025-10-22T00:00:00'),
          'America/Argentina/Buenos_Aires',
        ),
        updatedAt: zonedTimeToUtc(
          new Date('2025-10-22T00:00:00'),
          'America/Argentina/Buenos_Aires',
        ),
      });
      await queryRunner.manager.save(restaurant);

      // Create service windows
      const serviceWindows = [
        {
          id: 'SW1',
          restaurantId: 'R1',
          start: '12:00',
          end: '16:00',
        },
        {
          id: 'SW2',
          restaurantId: 'R1',
          start: '20:00',
          end: '23:45',
        },
      ];

      for (const windowData of serviceWindows) {
        const serviceWindow = this.serviceWindowRepository.create({
          ...windowData,
          createdAt: zonedTimeToUtc(
            new Date('2025-10-22T00:00:00'),
            'America/Argentina/Buenos_Aires',
          ),
          updatedAt: zonedTimeToUtc(
            new Date('2025-10-22T00:00:00'),
            'America/Argentina/Buenos_Aires',
          ),
        });
        await queryRunner.manager.save(serviceWindow);
      }

      // Create sector
      const sector = this.sectorRepository.create({
        id: 'S1',
        restaurantId: 'R1',
        name: 'Main Hall',
        createdAt: zonedTimeToUtc(
          new Date('2025-10-22T00:00:00'),
          'America/Argentina/Buenos_Aires',
        ),
        updatedAt: zonedTimeToUtc(
          new Date('2025-10-22T00:00:00'),
          'America/Argentina/Buenos_Aires',
        ),
      });
      await queryRunner.manager.save(sector);

      // Create tables
      const tables = [
        {
          id: 'T1',
          sectorId: 'S1',
          name: 'Table 1',
          minSize: 2,
          maxSize: 2,
        },
        {
          id: 'T2',
          sectorId: 'S1',
          name: 'Table 2',
          minSize: 2,
          maxSize: 4,
        },
        {
          id: 'T3',
          sectorId: 'S1',
          name: 'Table 3',
          minSize: 2,
          maxSize: 4,
        },
        {
          id: 'T4',
          sectorId: 'S1',
          name: 'Table 4',
          minSize: 4,
          maxSize: 6,
        },
        {
          id: 'T5',
          sectorId: 'S1',
          name: 'Table 5',
          minSize: 2,
          maxSize: 2,
        },
      ];

      for (const tableData of tables) {
        const table = this.tableRepository.create({
          ...tableData,
          createdAt: zonedTimeToUtc(
            new Date('2025-10-22T00:00:00'),
            'America/Argentina/Buenos_Aires',
          ),
          updatedAt: zonedTimeToUtc(
            new Date('2025-10-22T00:00:00'),
            'America/Argentina/Buenos_Aires',
          ),
        });
        await queryRunner.manager.save(table);
      }

      // Create existing booking
      const booking = this.bookingRepository.create({
        id: 'B1',
        restaurantId: 'R1',
        sectorId: 'S1',
        tableIds: ['T2'],
        partySize: 3,
        start: zonedTimeToUtc(
          new Date('2025-10-22T20:30:00'),
          'America/Argentina/Buenos_Aires',
        ),
        end: zonedTimeToUtc(
          new Date('2025-10-22T21:15:00'),
          'America/Argentina/Buenos_Aires',
        ),
        durationMinutes: 45,
        status: BookingStatus.CONFIRMED,
        createdAt: zonedTimeToUtc(
          new Date('2025-10-22T18:00:00'),
          'America/Argentina/Buenos_Aires',
        ),
        updatedAt: zonedTimeToUtc(
          new Date('2025-10-22T18:00:00'),
          'America/Argentina/Buenos_Aires',
        ),
      });
      await queryRunner.manager.save(booking);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
