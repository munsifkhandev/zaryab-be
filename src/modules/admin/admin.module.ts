import { Module } from '@nestjs/common';
import { AdministrationController } from './admin.controller.js';
import { AdministrationService } from './admin.service.js';
@Module({controllers:[AdministrationController],providers:[AdministrationService]})
export class AdministrationModule {}
