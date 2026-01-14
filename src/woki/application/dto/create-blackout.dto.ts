import { z } from 'zod';
import { BlackoutReason } from '../../domain/types/blackout-reason.enum';

export const CreateBlackoutSchema = z.object({
  restaurantId: z.string(),
  sectorId: z.string().optional(), // If provided, can blackout whole sector
  tableIds: z.array(z.string()).optional(), // If empty and sectorId provided = whole sector
  start: z.string().datetime(),
  end: z.string().datetime(),
  reason: z.nativeEnum(BlackoutReason),
  notes: z.string().optional(),
});

export type CreateBlackoutRequest = z.infer<typeof CreateBlackoutSchema>;

export interface CreateBlackoutResponse {
  id: string;
  restaurantId: string;
  sectorId: string | null;
  tableIds: string[];
  start: string;
  end: string;
  reason: BlackoutReason;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
