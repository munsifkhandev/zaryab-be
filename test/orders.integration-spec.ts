import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';
import { CartService, type CartOwner } from '../src/modules/cart/cart.service.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';
import type { QuoteDto } from '../src/modules/orders/orders.dto.js';
import { testDatabaseUrl } from './helpers/test-database.js';
import { newSessionToken } from '../src/modules/auth/auth.tokens.js';

describe('COD checkout, ownership and cash ledger (isolated test database)',()=>{
  let database:PrismaService;
  beforeAll(async()=>{database=new PrismaService(new ConfigService({DATABASE_URL:testDatabaseUrl()}));await database.$connect();});
  afterAll(async()=>{await database?.$disconnect();});
  const rollback=new Error('rollback order fixtures');
  async function fixture(work:(f:{tx:Prisma.TransactionClient;orders:OrdersService;carts:CartService;owner:CartOwner;other:CartOwner;request:QuoteDto;variantId:string;locationId:string;actorId:string})=>Promise<void>) {
    try {await database.$transaction(async tx=>{
      const persistence=new Proxy(tx,{get(target,key){if(key==='$transaction')return (callback:(client:Prisma.TransactionClient)=>Promise<unknown>)=>callback(tx);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}}) as unknown as PrismaService;
      const config=new ConfigService({NODE_ENV:'test',COD_ENABLED:true});const carts=new CartService(persistence,config),orders=new OrdersService(persistence,carts,config),catalog=new CatalogService(persistence);
      const actor=await tx.user.create({data:{firstName:'Checkout',lastName:'Fixture',email:`${randomUUID()}@example.com`,passwordHash:'not-a-login-fixture'}});
      const other=await tx.user.create({data:{firstName:'Other',lastName:'Fixture',email:`${randomUUID()}@example.com`,passwordHash:'not-a-login-fixture'}});
      const category=await catalog.createCategory({name:'Checkout fixture',slug:`fixture-${randomUUID()}`},actor.id);
      const taxClass=`T${randomUUID().replaceAll('-','').slice(0,20)}`;
      const location=await tx.inventoryLocation.upsert({where:{code:'PRIMARY'},create:{code:'PRIMARY',name:'Primary'},update:{}});
      const product=await catalog.createProduct({name:'Checkout item',slug:`fixture-${randomUUID()}`,description:'',material:'',care:'',taxClass,categoryIds:[category.id],collectionIds:[],images:[{url:'https://example.com/item.jpg'}],variants:[{sku:`FIX-${randomUUID()}`,size:'M',colorName:'Black',colorHex:'#000000',price:1000}]},actor.id);
      const variant=(await catalog.adminProduct(product.id)).variants[0];
      await tx.inventoryBalance.update({where:{variantId_locationId:{variantId:variant.id,locationId:location.id}},data:{onHand:5}});
      await catalog.publish(product.id,actor.id);
      await tx.taxRate.create({data:{country:'PK',taxClass,rateBps:1000}});
      const shipping=await tx.shippingMethod.create({data:{name:'Fixture courier',countries:['PK'],fee:100,shippingTaxBps:500,isActive:true}});
      const owner:CartOwner={kind:'user',userId:actor.id};await carts.add(owner,variant.id,2);
      const request:QuoteDto={shippingMethodId:shipping.id,email:actor.email,shippingAddress:{firstName:'Checkout',lastName:'Fixture',phone:'+923001234567',line1:'Fixture street',city:'Lahore',country:'PK'}};
      await work({tx,orders,carts,owner,other:{kind:'user',userId:other.id},request,variantId:variant.id,locationId:location.id,actorId:actor.id});throw rollback;
    },{timeout:20000});}catch(error){if(error!==rollback)throw error;}
  }
  it('commits stock once, replays the same intent and reverses cancellation once',async()=>{await fixture(async f=>{
    const quote=await f.orders.quote(f.owner,f.request);expect(quote.grandTotal).toBe(2305);
    const order=await f.orders.place(f.owner,{quoteId:quote.id},'checkout-intent-1');
    expect(order).toMatchObject({status:'CONFIRMED',paymentStatus:'PENDING',grandTotal:2305});
    expect(JSON.stringify(order)).not.toContain('guestTokenHash');
    expect((await f.orders.place(f.owner,{quoteId:quote.id},'checkout-intent-1')).id).toBe(order.id);
    await expect(f.orders.place(f.owner,{quoteId:randomUUID()},'checkout-intent-1')).rejects.toBeInstanceOf(ConflictException);
    await expect(f.orders.detail(f.other,order.id)).rejects.toBeInstanceOf(NotFoundException);
    expect((await f.tx.inventoryBalance.findUniqueOrThrow({where:{variantId_locationId:{variantId:f.variantId,locationId:f.locationId}}})).onHand).toBe(3);
    await f.orders.cancel(order.id,'Customer cancelled',f.actorId,f.owner);await f.orders.cancel(order.id,'Retry cancellation',f.actorId,f.owner);
    expect((await f.tx.inventoryBalance.findUniqueOrThrow({where:{variantId_locationId:{variantId:f.variantId,locationId:f.locationId}}})).onHand).toBe(5);
    expect(await f.tx.stockMovement.count({where:{variantId:f.variantId,type:'RETURN'}})).toBe(1);
  });});
  it('rejects stale prices and quotes belonging to a different customer',async()=>{await fixture(async f=>{
    const quote=await f.orders.quote(f.owner,f.request);
    await expect(f.orders.place(f.other,{quoteId:quote.id},'other-checkout-intent')).rejects.toBeInstanceOf(ConflictException);
    await f.tx.productVariant.update({where:{id:f.variantId},data:{price:1100}});
    await expect(f.orders.place(f.owner,{quoteId:quote.id},'stale-checkout-intent')).rejects.toBeInstanceOf(ConflictException);
    expect(await f.tx.order.count({where:{customerId:f.actorId}})).toBe(0);
    expect((await f.carts.get(f.owner)).items[0].quantity).toBe(2);
  });});
  it('records collected cash once and bounds cumulative idempotent refunds',async()=>{await fixture(async f=>{
    const quote=await f.orders.quote(f.owner,f.request),order=await f.orders.place(f.owner,{quoteId:quote.id},'cash-checkout-intent');
    await expect(f.orders.collectCash(order.id,f.actorId)).rejects.toBeInstanceOf(ConflictException);
    await f.orders.status(order.id,{status:'PROCESSING',reason:'Packing order'},f.actorId);
    await f.orders.status(order.id,{status:'SHIPPED',reason:'Courier handover',carrier:'Fixture courier',trackingNumber:'FIX-123'},f.actorId);
    await f.orders.status(order.id,{status:'DELIVERED',reason:'Confirmed delivery'},f.actorId);
    await f.orders.collectCash(order.id,f.actorId);await f.orders.collectCash(order.id,f.actorId);
    expect(await f.tx.paymentTransaction.count({where:{orderId:order.id,kind:'CAPTURE'}})).toBe(1);
    await f.orders.refundCash(order.id,{amount:200,reason:'Cash returned to customer'},'cash-refund-one',f.actorId);
    await f.orders.refundCash(order.id,{amount:200,reason:'Cash returned to customer'},'cash-refund-one',f.actorId);
    await expect(f.orders.refundCash(order.id,{amount:201,reason:'Cash returned to customer'},'cash-refund-one',f.actorId)).rejects.toBeInstanceOf(ConflictException);
    await expect(f.orders.refundCash(order.id,{amount:order.grandTotal,reason:'Too much cash'},'cash-refund-two',f.actorId)).rejects.toBeInstanceOf(ConflictException);
    const final=await f.orders.refundCash(order.id,{amount:order.grandTotal-200,reason:'Remaining cash returned'},'cash-refund-three',f.actorId);
    expect(final.paymentStatus).toBe('REFUNDED');expect(await f.tx.refund.count({where:{orderId:order.id}})).toBe(2);
  });});
  it('enforces coupon limits and snapshots a priority-based exclusive promotion',async()=>{await fixture(async f=>{
    const coupon=await f.tx.coupon.create({data:{code:`AUTO_${randomUUID().replaceAll('-','').toUpperCase()}`,kind:'PERCENTAGE',value:1000,usageLimit:1,startsAt:new Date(Date.now()-60000),isActive:true}});
    await f.tx.promotion.create({data:{couponId:coupon.id,priority:10}});
    const quote=await f.orders.quote(f.owner,f.request);expect(quote).toMatchObject({discountTotal:200,grandTotal:2085,couponId:coupon.id});
    await f.orders.place(f.owner,{quoteId:quote.id},'promo-checkout-one');
    await f.carts.add(f.owner,f.variantId,1);
    await expect(f.orders.quote(f.owner,{shippingMethodId:f.request.shippingMethodId,email:f.request.email,shippingAddress:f.request.shippingAddress,billingAddress:f.request.billingAddress,couponCode:coupon.code})).rejects.toBeInstanceOf(ConflictException);
    expect((await f.orders.quote(f.owner,f.request)).discountTotal).toBe(0);
  });});
  it('claims a guest order during login merge and revokes guest access',async()=>{await fixture(async f=>{
    const initialized=await f.carts.initialize(newSessionToken());const guest:CartOwner={kind:'guest',token:initialized.token};
    await f.carts.add(guest,f.variantId,1);const quote=await f.orders.quote(guest,f.request);
    const order=await f.orders.place(guest,{quoteId:quote.id},'guest-checkout-intent');
    await expect(f.orders.detail(f.owner,order.id)).rejects.toBeInstanceOf(NotFoundException);
    expect((await f.carts.mergeOnLogin(f.actorId,initialized.token)).status).toBe('merged');
    expect((await f.orders.detail(f.owner,order.id)).customerId).toBe(f.actorId);
    await expect(f.orders.detail(guest,order.id)).rejects.toBeInstanceOf(NotFoundException);
  });});
});
