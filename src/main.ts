import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllConfigType } from './config/config.type';
import { SeedService } from './woki/infrastructure/persistence/seed.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  const configService = app.get(ConfigService<AllConfigType>);

  app.enableShutdownHooks();
  app.setGlobalPrefix(
    configService.getOrThrow('app.apiPrefix', { infer: true }),
    {
      exclude: ['/'],
    },
  );

  // Swagger documentation
  const options = new DocumentBuilder()
    .setTitle('WokiBrain API')
    .setDescription('WokiBrain - A compact booking engine for restaurants')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('docs', app, document);

  // Seed data on startup
  try {
    const seedService = app.get(SeedService);
    await seedService.seed();
    console.log('Database seeded successfully');
  } catch (error) {
    console.error('Failed to seed database:', error);
  }

  const port = configService.getOrThrow('app.port', { infer: true });
  await app.listen(port);
  console.log(`WokiBrain API is running on: http://localhost:${port}`);
  console.log(`Swagger documentation: http://localhost:${port}/docs`);
}
void bootstrap();
