import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';
import { AllConfigType } from '../config/config.type';

@Injectable()
export class TypeOrmConfigService implements TypeOrmOptionsFactory {
  constructor(private configService: ConfigService<AllConfigType>) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    // Use SQLite for WokiBrain
    const databasePath = process.env.DATABASE_PATH || 'woki.db';
    const dropSchema = process.env.DROP_SCHEMA_ON_STARTUP === 'true' || true; // Default to true for fresh database

    return {
      type: 'better-sqlite3',
      database: databasePath,
      synchronize: true,
      dropSchema: dropSchema, // Fresh database on each startup
      keepConnectionAlive: true,
      logging:
        this.configService.get('app.nodeEnv', { infer: true }) !== 'production',
      entities: [__dirname + '/../**/*.entity{.ts,.js}'],
      migrations: [__dirname + '/migrations/**/*{.ts,.js}'],
    } as TypeOrmModuleOptions;
  }
}
