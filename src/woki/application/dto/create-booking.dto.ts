import { z } from 'zod';

export const CreateBookingSchema = z.object({
  restaurantId: z.string().min(1),
  sectorId: z.string().min(1),
  partySize: z.number().int().positive(),
  durationMinutes: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  windowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  windowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

export type CreateBookingRequest = z.infer<typeof CreateBookingSchema>;

export interface CreateBookingResponse {
  id: string;
  restaurantId: string;
  sectorId: string;
  tableIds: string[];
  partySize: number;
  start: string; // ISO 8601
  end: string; // ISO 8601
  durationMinutes: number;
  status: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

