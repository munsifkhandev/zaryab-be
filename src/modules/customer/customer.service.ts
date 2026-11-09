import { ConflictException, Inject, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { transaction } from '../../common/database/transaction.js';
import { productInclude, publicProductSql, storeProduct } from '../catalog/catalog.policy.js';
import { PageQueryDto, ProductQueryDto } from '../catalog/catalog.dto.js';
import type { AddressInputDto } from '../orders/orders.dto.js';
import type { ReviewDto, ReviewQueryDto } from './customer.dto.js';

@Injectable()
export class CustomerFeaturesService {
  constructor(@Inject(PrismaService) private readonly db:PrismaService) {}
  addresses(userId:string,query:PageQueryDto) {return this.db.address.findMany({where:{userId},orderBy:[{createdAt:'asc'},{id:'asc'}],take:query.limit,skip:(query.page-1)*query.limit});}
  addressSave(userId:string,dto:AddressInputDto,id?:string) {return transaction(this.db,async tx=>{
    await tx.$queryRaw`SELECT id FROM users WHERE id=${userId}::uuid FOR UPDATE`;
    if(!id&&await tx.address.count({where:{userId}})>=20)throw new ConflictException();
    const data={firstName:dto.firstName,lastName:dto.lastName,phone:dto.phone,line1:dto.line1,line2:dto.line2??null,city:dto.city,region:dto.region??null,postalCode:dto.postalCode??null,country:dto.country};
    if(id) {if(!(await tx.address.updateMany({where:{id,userId},data})).count)throw new NotFoundException();return tx.address.findUniqueOrThrow({where:{id}});}
    return tx.address.create({data:{...data,userId}});
  });}
  addressRemove(userId:string,id:string) {return transaction(this.db,async tx=>{
    if(!(await tx.address.deleteMany({where:{id,userId}})).count)throw new NotFoundException();return {removed:true};
  });}

  wishlist(userId:string,query:PageQueryDto) {return transaction(this.db,async tx=>{
    const saved=await tx.wishlistItem.findMany({where:{userId},orderBy:[{createdAt:'desc'},{productId:'asc'}],take:query.limit,skip:(query.page-1)*query.limit});
    const eligible=saved.length?await tx.$queryRaw<{id:string}[]>`SELECT id FROM (${publicProductSql(new ProductQueryDto())}) q WHERE id IN (${Prisma.join(saved.map(i=>Prisma.sql`${i.productId}::uuid`))})`:[];
    const products=await tx.product.findMany({where:{id:{in:eligible.map(p=>p.id)}},include:productInclude});
    return {items:saved.map(item=>({productId:item.productId,product:products.find(p=>p.id===item.productId)?storeProduct(products.find(p=>p.id===item.productId)!):null})),total:await tx.wishlistItem.count({where:{userId}})};
  });}
  wishAdd(userId:string,productId:string) {return transaction(this.db,async tx=>{
    await tx.$queryRaw`SELECT id FROM users WHERE id=${userId}::uuid FOR UPDATE`;
    const exists=await tx.wishlistItem.findUnique({where:{userId_productId:{userId,productId}}});if(exists)return {saved:true};
    if(await tx.wishlistItem.count({where:{userId}})>=200)throw new ConflictException();
    if(!(await tx.$queryRaw<{id:string}[]>`SELECT id FROM (${publicProductSql(new ProductQueryDto())}) q WHERE id=${productId}::uuid`).length)throw new NotFoundException();
    await tx.wishlistItem.create({data:{userId,productId}});return {saved:true};
  });}
  wishRemove(userId:string,productId:string) {return transaction(this.db,async tx=>{await tx.wishlistItem.deleteMany({where:{userId,productId}});return {removed:true};});}

  review(userId:string,dto:ReviewDto) {return transaction(this.db,async tx=>{
    const purchase=await tx.order.findFirst({where:{customerId:userId,status:'DELIVERED',paidAt:{not:null},items:{some:{productId:dto.productId}}},select:{id:true}});
    if(!purchase)throw new ForbiddenException();
    return tx.productReview.create({data:{userId,productId:dto.productId,rating:dto.rating,title:dto.title,body:dto.body}});
  });}
  publicReviews(productId:string,query:PageQueryDto) {return transaction(this.db,async tx=>{
    const product=await tx.product.findFirst({where:{id:productId,status:'PUBLISHED',publishedAt:{lte:new Date()}},select:{id:true}});if(!product)throw new NotFoundException();
    const where={productId,status:'PUBLISHED'};
    const records=await tx.productReview.findMany({where,select:{id:true,rating:true,title:true,body:true,createdAt:true,user:{select:{firstName:true,status:true}}},orderBy:[{createdAt:'desc'},{id:'asc'}],take:query.limit,skip:(query.page-1)*query.limit});
    return {items:records.map(({user,...record})=>({...record,author:user.status==='ARCHIVED'?'Customer':user.firstName,verifiedPurchase:true})),total:await tx.productReview.count({where})};
  });}
  reviews(query:ReviewQueryDto) {return this.db.productReview.findMany({where:query.status?{status:query.status}:{},orderBy:[{createdAt:'desc'},{id:'asc'}],take:query.limit,skip:(query.page-1)*query.limit});}
  moderate(id:string,status:string,actorId:string) {return transaction(this.db,async tx=>{
    if(!(await tx.productReview.updateMany({where:{id},data:{status}})).count)throw new NotFoundException();
    await tx.auditLog.create({data:{actorId,action:'review.moderate',entityType:'product_review',entityId:id,metadata:{status}}});return tx.productReview.findUniqueOrThrow({where:{id}});
  });}
}
