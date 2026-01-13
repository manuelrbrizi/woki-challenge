import { z } from 'zod';

export const ListBookingsQuerySchema = z.object({
  restaurantId: z.string().min(1),
  sectorId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type ListBookingsQuery = z.infer<typeof ListBookingsQuerySchema>;

export interface ListBookingsResponse {
  date: string;
  items: BookingItem[];
}

export interface BookingItem {
  id: string;
  tableIds: string[];
  partySize: number;
  start: string; // ISO 8601
  end: string; // ISO 8601
  status: string;
}
