import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Idempotency } from '../../../domain/entities/idempotency.entity';
import { IdempotencyRepository as IIdempotencyRepository } from '../../../ports/repositories/idempotency.repository.interface';

@Injectable()
export class IdempotencyRepository implements IIdempotencyRepository {
  constructor(
    @InjectRepository(Idempotency)
    private readonly repository: Repository<Idempotency>,
  ) {}

  async findById(key: string): Promise<Idempotency | null> {
    return this.repository.findOne({
      where: { id: key },
      relations: ['booking'],
    });
  }

  async create(idempotency: Idempotency): Promise<Idempotency> {
    const newIdempotency = this.repository.create(idempotency);
    return this.repository.save(newIdempotency);
  }

  async deleteExpired(): Promise<void> {
    const now = new Date();
    await this.repository.delete({
      expiresAt: LessThan(now),
    });
  }

  async deleteAll(): Promise<void> {
    await this.repository.clear();
  }

  async nullifyBookingId(bookingId: string): Promise<void> {
    await this.repository.update({ bookingId }, { bookingId: null });
  }
}
