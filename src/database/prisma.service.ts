import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(ConfigService) config: ConfigService) {
    const connectionString = config.getOrThrow<string>('DATABASE_URL');
    const adapter = new PrismaPg(
      {
        connectionString,
        max: 10,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
        query_timeout: 5000,
        statement_timeout: 5000,
      },
      {
        schema:
          new URL(connectionString).searchParams.get('schema') ?? 'public',
        onPoolError: () =>
          Logger.error('PostgreSQL pool connection failed.', 'PrismaService'),
      },
    );
    super({ adapter, errorFormat: 'minimal' });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      // The pg adapter creates its pool lazily; query once to verify credentials at startup.
      await this.$queryRaw`SELECT 1`;
    } catch {
      await this.$disconnect().catch(() => undefined);
      this.logger.error(
        'Database initialization failed. Check the database service and configuration.',
      );
      throw new Error('Database initialization failed.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
