import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, Permissions, Public } from '../auth/auth.metadata.js';
import type { AuthContext } from '../auth/auth.types.js';
import { AddressInputDto } from '../orders/orders.dto.js';
import { PageQueryDto } from '../catalog/catalog.dto.js';
import { CustomerFeaturesService } from './customer.service.js';
import { ReviewDto, ReviewModerationDto, ReviewQueryDto, WishlistDto } from './customer.dto.js';
const uuid=new ParseUUIDPipe({version:'4'});
@ApiCookieAuth() @ApiTags('Addresses, wishlist and reviews') @Controller()
export class CustomerFeaturesController {
  constructor(@Inject(CustomerFeaturesService) private readonly service:CustomerFeaturesService) {}
  @Get('customer/addresses') addresses(@CurrentAuth() auth:AuthContext,@Query() q:PageQueryDto) {return this.service.addresses(auth.user.id,q);}
  @Post('customer/addresses') address(@CurrentAuth() auth:AuthContext,@Body() dto:AddressInputDto) {return this.service.addressSave(auth.user.id,dto);}
  @Patch('customer/addresses/:id') addressUpdate(@Param('id',uuid) id:string,@CurrentAuth() auth:AuthContext,@Body() dto:AddressInputDto) {return this.service.addressSave(auth.user.id,dto,id);}
  @Delete('customer/addresses/:id') addressRemove(@Param('id',uuid) id:string,@CurrentAuth() auth:AuthContext) {return this.service.addressRemove(auth.user.id,id);}
  @Get('customer/wishlist') wishlist(@CurrentAuth() auth:AuthContext,@Query() q:PageQueryDto) {return this.service.wishlist(auth.user.id,q);}
  @Post('customer/wishlist/items') wish(@CurrentAuth() auth:AuthContext,@Body() dto:WishlistDto) {return this.service.wishAdd(auth.user.id,dto.productId);}
  @Delete('customer/wishlist/items/:id') wishRemove(@Param('id',uuid) id:string,@CurrentAuth() auth:AuthContext) {return this.service.wishRemove(auth.user.id,id);}
  @Post('customer/reviews') review(@CurrentAuth() auth:AuthContext,@Body() dto:ReviewDto) {return this.service.review(auth.user.id,dto);}
  @Public() @Get('store/products/:id/reviews') publicReviews(@Param('id',uuid) id:string,@Query() q:PageQueryDto) {return this.service.publicReviews(id,q);}
  @Get('admin/reviews') @Permissions('products.read') reviews(@Query() q:ReviewQueryDto) {return this.service.reviews(q);}
  @Patch('admin/reviews/:id') @Permissions('products.update') moderate(@Param('id',uuid) id:string,@Body() dto:ReviewModerationDto,@CurrentAuth() auth:AuthContext) {return this.service.moderate(id,dto.status,auth.user.id);}
}
