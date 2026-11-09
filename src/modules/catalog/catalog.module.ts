import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { CatalogService } from './catalog.service.js';
import { StoreCatalogController } from './store-catalog.controller.js';
import { AdminProductsController, AdminTaxonomyController } from './admin-catalog.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [StoreCatalogController, AdminProductsController, AdminTaxonomyController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
