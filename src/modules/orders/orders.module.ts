import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { CartModule } from '../cart/cart.module.js';
import { OrdersService } from './orders.service.js';
import { CheckoutSettingsService } from './checkout-settings.service.js';
import { AdminOrdersController, CheckoutSettingsController, CustomerOrdersController, PublicShippingController } from './orders.controller.js';
@Module({imports:[PrismaModule,CartModule],providers:[OrdersService,CheckoutSettingsService],controllers:[CustomerOrdersController,AdminOrdersController,CheckoutSettingsController,PublicShippingController],exports:[OrdersService]})
export class OrdersModule {}
