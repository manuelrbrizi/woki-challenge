import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { BlackoutCommandService } from './blackout-command.service';
import { RestaurantRepository } from '../../ports/repositories/restaurant.repository.interface';
import { SectorRepository } from '../../ports/repositories/sector.repository.interface';
import { TableRepository } from '../../ports/repositories/table.repository.interface';
import { BlackoutRepository } from '../../ports/repositories/blackout.repository.interface';
import {
  RESTAURANT_REPOSITORY,
  SECTOR_REPOSITORY,
  TABLE_REPOSITORY,
  BLACKOUT_REPOSITORY,
} from '../../tokens';
import { BlackoutReason } from '../../domain/types/blackout-reason.enum';

describe('BlackoutCommandService', () => {
  let service: BlackoutCommandService;
  let restaurantRepository: jest.Mocked<RestaurantRepository>;
  let sectorRepository: jest.Mocked<SectorRepository>;
  let tableRepository: jest.Mocked<TableRepository>;
  let blackoutRepository: jest.Mocked<BlackoutRepository>;

  beforeEach(async () => {
    const mockRestaurantRepository = {
      findById: jest.fn(),
    };

    const mockSectorRepository = {
      findById: jest.fn(),
    };

    const mockTableRepository = {
      findBySectorId: jest.fn(),
    };

    const mockBlackoutRepository = {
      findById: jest.fn(),
      findByDate: jest.fn(),
      findByTableIdsAndDate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlackoutCommandService,
        {
          provide: RESTAURANT_REPOSITORY,
          useValue: mockRestaurantRepository,
        },
        {
          provide: SECTOR_REPOSITORY,
          useValue: mockSectorRepository,
        },
        {
          provide: TABLE_REPOSITORY,
          useValue: mockTableRepository,
        },
        {
          provide: BLACKOUT_REPOSITORY,
          useValue: mockBlackoutRepository,
        },
      ],
    }).compile();

    service = module.get<BlackoutCommandService>(BlackoutCommandService);
    restaurantRepository = module.get(RESTAURANT_REPOSITORY);
    sectorRepository = module.get(SECTOR_REPOSITORY);
    tableRepository = module.get(TABLE_REPOSITORY);
    blackoutRepository = module.get(BLACKOUT_REPOSITORY);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createBlackout', () => {
    const mockRestaurant = {
      id: 'R1',
      name: 'Test Restaurant',
      timezone: 'America/Argentina/Buenos_Aires',
    };

    const mockSector = {
      id: 'S1',
      restaurantId: 'R1',
      name: 'Main Hall',
    };

    const mockTables = [
      { id: 'T1', sectorId: 'S1', name: 'Table 1', minSize: 2, maxSize: 2 },
      { id: 'T2', sectorId: 'S1', name: 'Table 2', minSize: 2, maxSize: 4 },
    ];

    beforeEach(() => {
      restaurantRepository.findById.mockResolvedValue(mockRestaurant as any);
      sectorRepository.findById.mockResolvedValue(mockSector as any);
      tableRepository.findBySectorId.mockResolvedValue(mockTables as any);
    });

    it('should create a table-specific blackout', async () => {
      const request = {
        restaurantId: 'R1',
        sectorId: 'S1',
        tableIds: ['T1', 'T2'],
        date: '2025-10-22',
        startTime: '20:00',
        endTime: '22:00',
        reason: BlackoutReason.MAINTENANCE,
        notes: 'Table repair',
      };

      // Expected UTC times (Buenos Aires UTC-3: 20:00 local = 23:00 UTC)
      const savedBlackout = {
        id: 'BLK_TEST123',
        restaurantId: 'R1',
        sectorId: 'S1',
        tableIds: ['T1', 'T2'],
        start: new Date('2025-10-22T23:00:00Z'),
        end: new Date('2025-10-23T01:00:00Z'),
        reason: BlackoutReason.MAINTENANCE,
        notes: 'Table repair',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      blackoutRepository.create.mockResolvedValue(savedBlackout as any);

      const result = await service.createBlackout(request);

      expect(result).toBeDefined();
      expect(result.id).toBe('BLK_TEST123');
      expect(result.tableIds).toEqual(['T1', 'T2']);
      expect(result.reason).toBe(BlackoutReason.MAINTENANCE);
      expect(blackoutRepository.create).toHaveBeenCalled();
    });

    it('should create a sector-wide blackout', async () => {
      const request = {
        restaurantId: 'R1',
        sectorId: 'S1',
        tableIds: [],
        date: '2025-10-22',
        startTime: '20:00',
        endTime: '23:00',
        reason: BlackoutReason.PRIVATE_EVENT,
        notes: 'Private party',
      };

      // Expected UTC times (Buenos Aires UTC-3: 20:00 local = 23:00 UTC, 23:00 local = 02:00 UTC next day)
      const savedBlackout = {
        id: 'BLK_TEST456',
        restaurantId: 'R1',
        sectorId: 'S1',
        tableIds: [],
        start: new Date('2025-10-22T23:00:00Z'),
        end: new Date('2025-10-23T02:00:00Z'),
        reason: BlackoutReason.PRIVATE_EVENT,
        notes: 'Private party',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      blackoutRepository.create.mockResolvedValue(savedBlackout as any);

      const result = await service.createBlackout(request);

      expect(result).toBeDefined();
      expect(result.tableIds).toEqual([]);
      expect(result.sectorId).toBe('S1');
      expect(blackoutRepository.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException if restaurant not found', async () => {
      restaurantRepository.findById.mockResolvedValue(null);

      const request = {
        restaurantId: 'R999',
        sectorId: 'S1',
        tableIds: ['T1'],
        date: '2025-10-22',
        startTime: '20:00',
        endTime: '22:00',
        reason: BlackoutReason.MAINTENANCE,
      };

      await expect(service.createBlackout(request)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if sector not found', async () => {
      sectorRepository.findById.mockResolvedValue(null);

      const request = {
        restaurantId: 'R1',
        sectorId: 'S999',
        tableIds: ['T1'],
        date: '2025-10-22',
        startTime: '20:00',
        endTime: '22:00',
        reason: BlackoutReason.MAINTENANCE,
      };

      await expect(service.createBlackout(request)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if sector belongs to different restaurant', async () => {
      const wrongSector = {
        id: 'S1',
        restaurantId: 'R2', // Different restaurant
        name: 'Main Hall',
      };
      sectorRepository.findById.mockResolvedValue(wrongSector as any);

      const request = {
        restaurantId: 'R1',
        sectorId: 'S1',
        tableIds: ['T1'],
        date: '2025-10-22',
        startTime: '20:00',
        endTime: '22:00',
        reason: BlackoutReason.MAINTENANCE,
      };

      await expect(service.createBlackout(request)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if table not found', async () => {
      const request = {
        restaurantId: 'R1',
        sectorId: 'S1',
        tableIds: ['T999'], // Non-existent table
        date: '2025-10-22',
        startTime: '20:00',
        endTime: '22:00',
        reason: BlackoutReason.MAINTENANCE,
      };

      await expect(service.createBlackout(request)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if start >= end', async () => {
      const request = {
        restaurantId: 'R1',
        sectorId: 'S1',
        tableIds: ['T1'],
        date: '2025-10-22',
        startTime: '22:00',
        endTime: '20:00', // End before start
        reason: BlackoutReason.MAINTENANCE,
      };

      await expect(service.createBlackout(request)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if tableIds provided without sectorId', async () => {
      const request = {
        restaurantId: 'R1',
        // sectorId missing
        tableIds: ['T1'],
        date: '2025-10-22',
        startTime: '20:00',
        endTime: '22:00',
        reason: BlackoutReason.MAINTENANCE,
      };

      await expect(service.createBlackout(request)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if neither sectorId nor tableIds provided', async () => {
      const request = {
        restaurantId: 'R1',
        // sectorId and tableIds both missing
        date: '2025-10-22',
        startTime: '20:00',
        endTime: '22:00',
        reason: BlackoutReason.MAINTENANCE,
      };

      await expect(service.createBlackout(request)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('deleteBlackout', () => {
    it('should delete a blackout', async () => {
      const blackout = {
        id: 'BLK_TEST123',
        restaurantId: 'R1',
        sectorId: 'S1',
        tableIds: ['T1'],
        start: new Date(),
        end: new Date(),
        reason: BlackoutReason.MAINTENANCE,
        notes: null,
      };

      blackoutRepository.findById.mockResolvedValue(blackout as any);
      blackoutRepository.delete.mockResolvedValue();

      await service.deleteBlackout('BLK_TEST123');

      expect(blackoutRepository.delete).toHaveBeenCalledWith('BLK_TEST123');
    });

    it('should throw NotFoundException if blackout not found', async () => {
      blackoutRepository.findById.mockResolvedValue(null);

      await expect(service.deleteBlackout('BLK_NOTFOUND')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
