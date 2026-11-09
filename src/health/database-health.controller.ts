import {
  Controller,
  Get,
  Inject,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../database/prisma.service.js';
import { HealthResponseDto } from './health-response.dto.js';
import { Public } from '../modules/auth/auth.metadata.js';

@Public()
@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class DatabaseHealthController {
  private readonly logger = new Logger(DatabaseHealthController.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('live')
  @ApiOkResponse({ type: HealthResponseDto })
  live() {
    return { status: 'ok' } as const;
  }

  @Get('ready')
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ description: 'A required dependency is unavailable.' })
  async ready() {
    await this.check();
    return { status: 'ok' } as const;
  }

  @Get('database')
  @ApiOkResponse({ description: 'Legacy database connectivity probe.' })
  @ApiServiceUnavailableResponse({ description: 'Database is unavailable.' })
  async check() {
    try {
      const rows = await this.prisma.$queryRaw<
        { ok: number }[]
      >`SELECT 1 AS ok`;
      if (rows[0]?.ok !== 1) throw new Error('Unexpected health query result');
      return { status: 'ok', database: 'connected' } as const;
    } catch {
      this.logger.warn('Database health check failed.');
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'disconnected',
      });
    }
  }
}
