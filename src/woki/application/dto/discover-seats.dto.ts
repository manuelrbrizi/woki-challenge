import { z } from 'zod';

export const DiscoverSeatsQuerySchema = z.object({
  restaurantId: z.string().min(1),
  sectorId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  partySize: z.coerce.number().int().positive(),
  duration: z.coerce.number().int().positive(),
  windowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  windowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export type DiscoverSeatsQuery = z.infer<typeof DiscoverSeatsQuerySchema>;

export interface DiscoverSeatsResponse {
  slotMinutes: number;
  durationMinutes: number;
  candidates: Candidate[];
}

export interface Candidate {
  kind: 'single' | 'combo';
  tableIds: string[];
  start: string; // ISO 8601
  end: string; // ISO 8601
}

