import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { CustomerFeaturesController } from './customer.controller.js';
import { CustomerFeaturesService } from './customer.service.js';
@Module({imports:[PrismaModule],controllers:[CustomerFeaturesController],providers:[CustomerFeaturesService]})
export class CustomerFeaturesModule {}
