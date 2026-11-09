import { Module } from '@nestjs/common';
import { ContentService } from './content.service.js';
import { AdminContentController, StoreContentController } from './content.controller.js';
import { IntegrationsModule } from '../../infrastructure/integrations.module.js';
import { NewsletterController } from './newsletter.controller.js';
import { NewsletterService } from './newsletter.service.js';
@Module({imports:[IntegrationsModule],controllers:[AdminContentController,StoreContentController,NewsletterController],providers:[ContentService,NewsletterService]})
export class ContentModule {}
