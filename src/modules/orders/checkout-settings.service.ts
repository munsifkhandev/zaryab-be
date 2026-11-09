import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { transaction } from '../../common/database/transaction.js';
import type { CouponDto, PromotionDto, ShippingMethodDto, TaxRateDto, UpdateCouponDto, UpdateShippingMethodDto } from './orders.dto.js';
import type { PageQueryDto } from '../catalog/catalog.dto.js';
import { cents } from './pricing.policy.js';
import type { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class CheckoutSettingsService {
  constructor(@Inject(PrismaService) private readonly db:PrismaService) {}
  shipping(publicOnly=false) {return this.db.shippingMethod.findMany({where:publicOnly?{isActive:true}:{},orderBy:{id:'asc'},take:100});}
  taxes() {return this.db.taxRate.findMany({orderBy:[{country:'asc'},{taxClass:'asc'}],take:500});}
  async promotions() {return (await this.db.promotion.findMany({include:{coupon:true},orderBy:[{priority:'desc'},{id:'asc'}],take:100})).map(p=>({...p,coupon:{...p.coupon,minimumSubtotal:cents(p.coupon.minimumSubtotal)}}));}
  promotion(dto:PromotionDto,actorId:string) {return transaction(this.db,async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('promotion-configuration',0))`;
    const old=await tx.promotion.findUnique({where:{couponId:dto.couponId}});
    if(!old&&await tx.promotion.count()>=100)throw new ConflictException();
    const value=await tx.promotion.upsert({where:{couponId:dto.couponId},create:dto,update:{priority:dto.priority}});
    await tx.auditLog.create({data:{actorId,action:'promotion.configure',entityType:'promotion',entityId:value.id}});return value;
  });}
  shippingCreate(dto:ShippingMethodDto,actorId:string) {return transaction(this.db,async tx=>{
    const value=await tx.shippingMethod.create({data:dto});
    await tx.auditLog.create({data:{actorId,action:'shipping.create',entityType:'shipping_method',entityId:value.id}});return value;
  });}
  shippingUpdate(id:string,dto:UpdateShippingMethodDto,actorId:string) {return transaction(this.db,async tx=>{
    const changed=await tx.shippingMethod.updateMany({where:{id},data:dto});if(!changed.count)throw new NotFoundException();
    await tx.auditLog.create({data:{actorId,action:'shipping.update',entityType:'shipping_method',entityId:id}});return tx.shippingMethod.findUniqueOrThrow({where:{id}});
  });}
  tax(dto:TaxRateDto,actorId:string) {return transaction(this.db,async tx=>{
    const value=await tx.taxRate.upsert({where:{country_taxClass:{country:dto.country,taxClass:dto.taxClass}},create:dto,update:{rateBps:dto.rateBps}});
    await tx.auditLog.create({data:{actorId,action:'tax.configure',entityType:'tax_rate',entityId:value.id}});return value;
  });}
  async coupons(query:PageQueryDto) {const items=await this.db.coupon.findMany({include:{targets:true},orderBy:{id:'asc'},take:query.limit,skip:(query.page-1)*query.limit});return items.map(c=>({...c,minimumSubtotal:cents(c.minimumSubtotal)}));}
  coupon(dto:CouponDto,actorId:string) {return transaction(this.db,tx=>this.saveCoupon(tx,dto,actorId));}
  private async saveCoupon(tx:Prisma.TransactionClient,dto:CouponDto,actorId:string,id?:string) {
    const startsAt=new Date(dto.startsAt);const endsAt=dto.endsAt?new Date(dto.endsAt):null;
    if((endsAt&&endsAt<=startsAt)||(dto.kind==='PERCENTAGE'&&dto.value>10000))throw new BadRequestException();
    const {productIds=[],collectionIds=[],minimumSubtotal,...fields}=dto;
    const data={...fields,minimumSubtotal:BigInt(minimumSubtotal??0),startsAt,endsAt};
    const value=id?await tx.coupon.update({where:{id},data:{...data,targets:{deleteMany:{},create:[...productIds.map(productId=>({productId})),...collectionIds.map(collectionId=>({collectionId}))]}}})
      :await tx.coupon.create({data:{...data,targets:{create:[...productIds.map(productId=>({productId})),...collectionIds.map(collectionId=>({collectionId}))]}}});
    await tx.auditLog.create({data:{actorId,action:id?'coupon.update':'coupon.create',entityType:'coupon',entityId:value.id}});
    return {...value,minimumSubtotal:cents(value.minimumSubtotal)};
  }
  couponUpdate(id:string,dto:UpdateCouponDto,actorId:string) {return transaction(this.db,async tx=>{
    await tx.$queryRaw`SELECT id FROM coupons WHERE id=${id}::uuid FOR UPDATE`;
    const existing=await tx.coupon.findUnique({where:{id},include:{targets:true}});if(!existing)throw new NotFoundException();
    return this.saveCoupon(tx,{code:dto.code??existing.code,kind:(dto.kind??existing.kind) as CouponDto['kind'],value:dto.value??existing.value,
      minimumSubtotal:dto.minimumSubtotal??cents(existing.minimumSubtotal),usageLimit:dto.usageLimit===undefined?existing.usageLimit:dto.usageLimit,
      perCustomerLimit:dto.perCustomerLimit===undefined?existing.perCustomerLimit:dto.perCustomerLimit,startsAt:dto.startsAt??existing.startsAt.toISOString(),
      endsAt:dto.endsAt===undefined?existing.endsAt?.toISOString()??null:dto.endsAt,isActive:dto.isActive??existing.isActive,
      productIds:dto.productIds??existing.targets.flatMap(t=>t.productId?[t.productId]:[]),collectionIds:dto.collectionIds??existing.targets.flatMap(t=>t.collectionId?[t.collectionId]:[])},actorId,id);
  });}
}
