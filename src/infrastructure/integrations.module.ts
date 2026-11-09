import { Module } from '@nestjs/common';
import { EmailService } from './email.service.js';
import { OutboxWorker } from './outbox.worker.js';
import { PrismaModule } from '../database/prisma.module.js';
@Module({imports:[PrismaModule],providers:[EmailService,OutboxWorker],exports:[EmailService]})
export class IntegrationsModule {}
