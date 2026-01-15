import { Idempotency } from '../../domain/entities/idempotency.entity';

export interface IdempotencyRepository {
  findById(key: string): Promise<Idempotency | null>;
  create(idempotency: Idempotency): Promise<Idempotency>;
  deleteExpired(): Promise<void>;
  deleteAll(): Promise<void>; // For testing
  nullifyBookingId(bookingId: string): Promise<void>;
}
