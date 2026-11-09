import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';

@Module({ imports: [PrismaModule], controllers: [CartController], providers: [CartService], exports: [CartService] })
export class CartModule {}
