import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';

@Module({ imports: [PrismaModule], controllers: [InventoryController], providers: [InventoryService], exports: [InventoryService] })
export class InventoryModule {}
