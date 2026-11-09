import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentAuth, GuestAllowed, Permissions, Public } from '../auth/auth.metadata.js';
import type { AuthContext, AuthRequest } from '../auth/auth.types.js';
import { CartService } from '../cart/cart.service.js';
import { PageQueryDto } from '../catalog/catalog.dto.js';
import { OrdersService } from './orders.service.js';
import { CheckoutSettingsService } from './checkout-settings.service.js';
import { CouponDto, OrderQueryDto, OrderStatusDto, PlaceOrderDto, PromotionDto, QuoteDto, ReasonDto, RefundDto, ShippingMethodDto, TaxRateDto, UpdateCouponDto, UpdateShippingMethodDto } from './orders.dto.js';
const uuid=new ParseUUIDPipe({version:'4'});

@GuestAllowed() @ApiCookieAuth() @ApiTags('Checkout and customer orders') @Controller('customer')
export class CustomerOrdersController {
  constructor(@Inject(OrdersService) private readonly orders:OrdersService,@Inject(CartService) private readonly carts:CartService) {}
  @Post('checkout/quote') @Throttle({default:{limit:20,ttl:900000}})
  @ApiHeader({name:'Origin',required:true}) @ApiHeader({name:'X-CSRF-Token',required:true})
  quote(@Body() dto:QuoteDto,@Req() req:AuthRequest) {return this.orders.quote(this.carts.ownerFromRequest(req,true),dto);}
  @Post('checkout/orders') @Throttle({default:{limit:10,ttl:900000}})
  @ApiHeader({name:'Idempotency-Key',required:true}) @ApiHeader({name:'Origin',required:true}) @ApiHeader({name:'X-CSRF-Token',required:true})
  async place(@Body() dto:PlaceOrderDto,@Headers('idempotency-key') key:string|undefined,@Req() req:AuthRequest,@Res({passthrough:true}) res:Response) {
    const owner=this.carts.ownerFromRequest(req,true);const order=await this.orders.place(owner,dto,key);
    if(owner.kind==='guest'&&order.guestAccessExpiresAt)this.carts.setCookie(res,owner.token,order.guestAccessExpiresAt);
    return order;
  }
  @Get('orders') list(@Query() query:OrderQueryDto,@Req() req:AuthRequest) {return this.orders.list(this.carts.ownerFromRequest(req,false),query);}
  @Get('orders/:id') detail(@Param('id',uuid) id:string,@Req() req:AuthRequest) {return this.orders.detail(this.carts.ownerFromRequest(req,false),id);}
  @Post('orders/:id/cancel') @HttpCode(200)
  cancel(@Param('id',uuid) id:string,@Body() dto:ReasonDto,@Req() req:AuthRequest) {return this.orders.cancel(id,dto.reason,req.auth?.user.id??null,this.carts.ownerFromRequest(req,true));}
}

@ApiCookieAuth() @ApiTags('Admin orders') @Controller('admin/orders')
export class AdminOrdersController {
  constructor(@Inject(OrdersService) private readonly orders:OrdersService) {}
  @Get() @Permissions('orders.read') list(@Query() query:OrderQueryDto) {return this.orders.adminList(query);}
  @Get(':id') @Permissions('orders.read') detail(@Param('id',uuid) id:string) {return this.orders.adminDetail(id);}
  @Patch(':id/status') @Permissions('orders.update') status(@Param('id',uuid) id:string,@Body() dto:OrderStatusDto,@CurrentAuth() auth:AuthContext) {return this.orders.status(id,dto,auth.user.id);}
  @Post(':id/cancel') @HttpCode(200) @Permissions('orders.update') cancel(@Param('id',uuid) id:string,@Body() dto:ReasonDto,@CurrentAuth() auth:AuthContext) {return this.orders.cancel(id,dto.reason,auth.user.id);}
  @Post(':id/cod/collect') @HttpCode(200) @Permissions('payments.record')
  @ApiOperation({summary:'Record actual cash received for a delivered COD order.'})
  collect(@Param('id',uuid) id:string,@CurrentAuth() auth:AuthContext) {return this.orders.collectCash(id,auth.user.id);}
  @Post(':id/refunds/cash') @Permissions('orders.refund') @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiOperation({summary:'Record a cash refund already paid by staff; no bank/provider transfer is performed.'})
  refund(@Param('id',uuid) id:string,@Body() dto:RefundDto,@Headers('idempotency-key') key:string|undefined,@CurrentAuth() auth:AuthContext) {return this.orders.refundCash(id,dto,key,auth.user.id);}
}

@ApiCookieAuth() @ApiTags('Shipping, tax and coupons') @Controller('admin')
export class CheckoutSettingsController {
  constructor(@Inject(CheckoutSettingsService) private readonly settings:CheckoutSettingsService) {}
  @Get('shipping-methods') @Permissions('shipping.manage') shipping() {return this.settings.shipping();}
  @Post('shipping-methods') @Permissions('shipping.manage') createShipping(@Body() dto:ShippingMethodDto,@CurrentAuth() auth:AuthContext) {return this.settings.shippingCreate(dto,auth.user.id);}
  @Patch('shipping-methods/:id') @Permissions('shipping.manage') updateShipping(@Param('id',uuid) id:string,@Body() dto:UpdateShippingMethodDto,@CurrentAuth() auth:AuthContext) {return this.settings.shippingUpdate(id,dto,auth.user.id);}
  @Get('tax-rates') @Permissions('shipping.manage') taxes() {return this.settings.taxes();}
  @Post('tax-rates') @Permissions('shipping.manage') tax(@Body() dto:TaxRateDto,@CurrentAuth() auth:AuthContext) {return this.settings.tax(dto,auth.user.id);}
  @Get('coupons') @Permissions('promotions.manage') coupons(@Query() query:PageQueryDto) {return this.settings.coupons(query);}
  @Get('promotions') @Permissions('promotions.manage') promotions() {return this.settings.promotions();}
  @Post('promotions') @Permissions('promotions.manage') promotion(@Body() dto:PromotionDto,@CurrentAuth() auth:AuthContext) {return this.settings.promotion(dto,auth.user.id);}
  @Post('coupons') @Permissions('promotions.manage') coupon(@Body() dto:CouponDto,@CurrentAuth() auth:AuthContext) {return this.settings.coupon(dto,auth.user.id);}
  @Patch('coupons/:id') @Permissions('promotions.manage') couponUpdate(@Param('id',uuid) id:string,@Body() dto:UpdateCouponDto,@CurrentAuth() auth:AuthContext) {return this.settings.couponUpdate(id,dto,auth.user.id);}
}
@Public() @ApiTags('Store shipping') @Controller('store/shipping-methods')
export class PublicShippingController {
  constructor(@Inject(CheckoutSettingsService) private readonly settings:CheckoutSettingsService) {}
  @Get() list() {return this.settings.shipping(true);}
}
