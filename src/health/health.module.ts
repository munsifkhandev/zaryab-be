import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module.js';
import { DatabaseHealthController } from './database-health.controller.js';

@Module({ imports: [PrismaModule], controllers: [DatabaseHealthController] })
export class HealthModule {}
