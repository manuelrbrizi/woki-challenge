import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BlackoutQueryService } from './blackout-query.service';
import { RestaurantRepository } from '../../ports/repositories/restaurant.repository.interface';
import { SectorRepository } from '../../ports/repositories/sector.repository.interface';
import { BlackoutRepository } from '../../ports/repositories/blackout.repository.interface';
import {
  RESTAURANT_REPOSITORY,
  SECTOR_REPOSITORY,
  BLACKOUT_REPOSITORY,
} from '../../tokens';
import { BlackoutReason } from '../../domain/types/blackout-reason.enum';

describe('BlackoutQueryService', () => {
  let service: BlackoutQueryService;
  let restaurantRepository: jest.Mocked<RestaurantRepository>;
  let sectorRepository: jest.Mocked<SectorRepository>;
  let blackoutRepository: jest.Mocked<BlackoutRepository>;

  beforeEach(async () => {
    const mockRestaurantRepository = {
      findById: jest.fn(),
    };

    const mockSectorRepository = {
      findById: jest.fn(),
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
        BlackoutQueryService,
        {
          provide: RESTAURANT_REPOSITORY,
          useValue: mockRestaurantRepository,
        },
        {
          provide: SECTOR_REPOSITORY,
          useValue: mockSectorRepository,
        },
        {
          provide: BLACKOUT_REPOSITORY,
          useValue: mockBlackoutRepository,
        },
      ],
    }).compile();

    service = module.get<BlackoutQueryService>(BlackoutQueryService);
    restaurantRepository = module.get(RESTAURANT_REPOSITORY);
    sectorRepository = module.get(SECTOR_REPOSITORY);
    blackoutRepository = module.get(BLACKOUT_REPOSITORY);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listBlackouts', () => {
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

    beforeEach(() => {
      restaurantRepository.findById.mockResolvedValue(mockRestaurant as any);
      sectorRepository.findById.mockResolvedValue(mockSector as any);
    });

    it('should list blackouts for a date', async () => {
      const mockBlackouts = [
        {
          id: 'BLK_1',
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: ['T1'],
          start: new Date('2025-10-22T20:00:00Z'),
          end: new Date('2025-10-22T22:00:00Z'),
          reason: BlackoutReason.MAINTENANCE,
          notes: 'Table repair',
        },
        {
          id: 'BLK_2',
          restaurantId: 'R1',
          sectorId: 'S1',
          tableIds: [],
          start: new Date('2025-10-22T18:00:00Z'),
          end: new Date('2025-10-22T19:00:00Z'),
          reason: BlackoutReason.PRIVATE_EVENT,
          notes: null,
        },
      ];

      blackoutRepository.findByDate.mockResolvedValue(mockBlackouts as any);

      const query = {
        restaurantId: 'R1',
        sectorId: 'S1',
        date: '2025-10-22',
      };

      const result = await service.listBlackouts(query);

      expect(result).toBeDefined();
      expect(result.date).toBe('2025-10-22');
      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('BLK_1');
      expect(result.items[0].tableIds).toEqual(['T1']);
      expect(result.items[1].id).toBe('BLK_2');
      expect(result.items[1].tableIds).toEqual([]);
      expect(blackoutRepository.findByDate).toHaveBeenCalledWith(
        'R1',
        'S1',
        expect.any(Date),
        'America/Argentina/Buenos_Aires',
      );
    });

    it('should return empty list when no blackouts exist', async () => {
      blackoutRepository.findByDate.mockResolvedValue([]);

      const query = {
        restaurantId: 'R1',
        sectorId: 'S1',
        date: '2025-10-22',
      };

      const result = await service.listBlackouts(query);

      expect(result.items).toHaveLength(0);
    });

    it('should throw NotFoundException if restaurant not found', async () => {
      restaurantRepository.findById.mockResolvedValue(null);

      const query = {
        restaurantId: 'R999',
        sectorId: 'S1',
        date: '2025-10-22',
      };

      await expect(service.listBlackouts(query)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if sector not found', async () => {
      sectorRepository.findById.mockResolvedValue(null);

      const query = {
        restaurantId: 'R1',
        sectorId: 'S999',
        date: '2025-10-22',
      };

      await expect(service.listBlackouts(query)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if sector belongs to different restaurant', async () => {
      const wrongSector = {
        id: 'S1',
        restaurantId: 'R2',
        name: 'Main Hall',
      };
      sectorRepository.findById.mockResolvedValue(wrongSector as any);

      const query = {
        restaurantId: 'R1',
        sectorId: 'S1',
        date: '2025-10-22',
      };

      await expect(service.listBlackouts(query)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
