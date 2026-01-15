import { z } from 'zod';

export const ListBlackoutsQuerySchema = z.object({
  restaurantId: z.string(),
  sectorId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD format
});

export type ListBlackoutsQuery = z.infer<typeof ListBlackoutsQuerySchema>;

export interface ListBlackoutsResponse {
  date: string;
  items: Array<{
    id: string;
    sectorId: string | null;
    tableIds: string[];
    start: string;
    end: string;
    reason: string;
    notes: string | null;
  }>;
}
