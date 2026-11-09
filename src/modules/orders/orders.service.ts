import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { transaction } from '../../common/database/transaction.js';
import { CartService, type CartOwner } from '../cart/cart.service.js';
import { tokenHash } from '../auth/auth.tokens.js';
import { inventoryKey } from '../inventory/inventory.service.js';
import type { AddressInputDto, OrderQueryDto, OrderStatusDto, PlaceOrderDto, QuoteDto, RefundDto } from './orders.dto.js';
import { bps, calculatePrice, cents, fingerprint, type PriceLine } from './pricing.policy.js';

type Tx=Prisma.TransactionClient;
const orderInclude={items:true,addresses:true,history:{orderBy:{createdAt:'asc'}},shipments:{include:{events:true}},refunds:true} satisfies Prisma.OrderInclude;
type StoredOrder=Prisma.OrderGetPayload<{include:typeof orderInclude}>;
function addressSnapshot(address:AddressInputDto,email:string):Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify({firstName:address.firstName,lastName:address.lastName,phone:address.phone,line1:address.line1,line2:address.line2,city:address.city,region:address.region,postalCode:address.postalCode,country:address.country,email})) as Prisma.InputJsonValue;
}
function orderResponse(order:StoredOrder) {
  const {guestTokenHash:_guest,idempotencyKey:_key,requestHash:_hash,...safe}=order;
  return {...safe, subtotal:cents(order.subtotal),discountTotal:cents(order.discountTotal),shippingTotal:cents(order.shippingTotal),taxTotal:cents(order.taxTotal),grandTotal:cents(order.grandTotal),
    items:order.items.map(item=>({...item,discountTotal:cents(item.discountTotal),taxTotal:cents(item.taxTotal),lineTotal:cents(item.lineTotal)})),
    refunds:order.refunds.map(({idempotencyKey:_key,...refund})=>({...refund,amount:cents(refund.amount)}))};
}

@Injectable()
export class OrdersService {
  constructor(@Inject(PrismaService) private readonly db:PrismaService,@Inject(CartService) private readonly carts:CartService,@Inject(ConfigService) private readonly config:ConfigService) {}
  private async now(tx:Tx) {return (await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`)[0].now;}
  private ownerWhere(owner:CartOwner,now:Date):Prisma.OrderWhereInput {
    return owner.kind==='user'?{customerId:owner.userId}:{customerId:null,guestTokenHash:tokenHash(owner.token),guestAccessExpiresAt:{gt:now}};
  }
  private audit(tx:Tx,actorId:string|null,action:string,id:string) {return tx.auditLog.create({data:{actorId,action,entityType:'order',entityId:id}});}
  private async load(tx:Tx,id:string) {const order=await tx.order.findUnique({where:{id},include:orderInclude});if(!order)throw new NotFoundException();return order;}
  private async orderLock(tx:Tx,id:string) {if(!(await tx.$queryRaw<{id:string}[]>`SELECT id FROM orders WHERE id=${id}::uuid FOR UPDATE`).length)throw new NotFoundException();return this.load(tx,id);}
  private async ownedOrder(tx:Tx,id:string,owner:CartOwner) {const order=await tx.order.findFirst({where:{id,...this.ownerWhere(owner,await this.now(tx))},include:orderInclude});if(!order)throw new NotFoundException();return order;}

  private async price(tx:Tx,owner:CartOwner,cartId:string,request:QuoteDto) {
    if(!this.config.getOrThrow<boolean>('COD_ENABLED')) throw new ServiceUnavailableException();
    const cart=await tx.cart.findUniqueOrThrow({where:{id:cartId}});
    const snapshot=await this.carts.snapshot(tx,cart);
    if(!snapshot.canCheckout || snapshot.items.some(item=>!item.product||!item.color||!item.size||item.unitPrice===null))throw new ConflictException();
    const now=await this.now(tx);
    const shipping=await tx.shippingMethod.findFirst({where:{id:request.shippingMethodId,isActive:true,countries:{has:request.shippingAddress.country}}});
    if(!shipping) throw new ServiceUnavailableException();
    const variants=await tx.productVariant.findMany({where:{id:{in:snapshot.items.map(i=>i.variantId)}},select:{id:true,product:{select:{taxClass:true,collections:{select:{collectionId:true}}}}}});
    const rates=await tx.taxRate.findMany({where:{country:request.shippingAddress.country}});
    type Rule=Prisma.CouponGetPayload<{include:{targets:true}}>;
    const eligibleItem=(rule:Rule,productId:string,variantId:string)=>!rule.targets.length||rule.targets.some(t=>t.productId===productId||variants.find(v=>v.id===variantId)!.product.collections.some(c=>c.collectionId===t.collectionId));
    const usable=async(rule:Rule)=>{
      if(!rule.isActive||rule.startsAt>now||(rule.endsAt&&rule.endsAt<=now)||BigInt(snapshot.subtotal!)<rule.minimumSubtotal)return false;
      const eligibleSubtotal=snapshot.items.reduce((sum,i)=>sum+(i.product&&eligibleItem(rule,i.product.id,i.variantId)?BigInt(i.unitPrice??0)*BigInt(i.quantity):0n),0n);
      if(eligibleSubtotal===0n||(rule.kind==='PERCENTAGE'&&bps(eligibleSubtotal,rule.value)===0n))return false;
      if(rule.usageLimit!==null&&await tx.couponRedemption.count({where:{couponId:rule.id,releasedAt:null}})>=rule.usageLimit)return false;
      if(rule.perCustomerLimit!==null&&(owner.kind!=='user'||await tx.couponRedemption.count({where:{couponId:rule.id,customerId:owner.userId,releasedAt:null}})>=rule.perCustomerLimit))return false;
      return true;
    };
    let coupon=request.couponCode?await tx.coupon.findUnique({where:{code:request.couponCode},include:{targets:true}}):null;
    if(!request.couponCode) {
      const promotions=await tx.promotion.findMany({include:{coupon:{include:{targets:true}}},orderBy:[{priority:'desc'},{id:'asc'}],take:100});
      for(const promotion of promotions)if(await usable(promotion.coupon)){coupon=promotion.coupon;break;}
    }
    if(request.couponCode && (!coupon || !coupon.isActive || coupon.startsAt>now || (coupon.endsAt&&coupon.endsAt<=now)))throw new BadRequestException();
    if(coupon) {
      const count=await tx.couponRedemption.count({where:{couponId:coupon.id,releasedAt:null}});
      if(coupon.usageLimit!==null&&count>=coupon.usageLimit)throw new ConflictException();
      if(coupon.perCustomerLimit!==null) {
        if(owner.kind!=='user')throw new BadRequestException();
        if(await tx.couponRedemption.count({where:{couponId:coupon.id,customerId:owner.userId,releasedAt:null}})>=coupon.perCustomerLimit)throw new ConflictException();
      }
      if(BigInt(snapshot.subtotal!)<coupon.minimumSubtotal)throw new BadRequestException();
    }
    const lines:PriceLine[]=snapshot.items.map(item=>{
      const variant=variants.find(v=>v.id===item.variantId)!;
      const rate=rates.find(r=>r.taxClass===variant.product.taxClass);
      if(!rate)throw new ServiceUnavailableException();
      const eligible=!coupon||eligibleItem(coupon,item.product!.id,item.variantId);
      return {variantId:item.variantId,productId:item.product!.id,name:item.product!.name,sku:item.sku!,quantity:item.quantity,unitPrice:item.unitPrice!,size:item.size!,color:item.color!,taxBps:rate.rateBps,eligible};
    }).sort((a,b)=>a.variantId.localeCompare(b.variantId));
    if(coupon&&!lines.some(line=>line.eligible))throw new BadRequestException();
    const result=calculatePrice(lines,shipping,coupon??undefined);
    if(coupon&&result.discountTotal===0)throw new BadRequestException();
    return {...result,stackingPolicy:'EXCLUSIVE' as const,shippingName:shipping.name,shippingTaxBps:shipping.shippingTaxBps,couponId:coupon?.id??null,couponCode:coupon?.code??null};
  }

  quote(owner:CartOwner,request:QuoteDto) {
    return transaction(this.db,async tx=>{
      const cart=await this.carts.owned(tx,owner);
      const price=await this.price(tx,owner,cart.id,request);
      const expiresAt=new Date((await this.now(tx)).getTime()+600000);
      const quote=await tx.checkoutSession.create({data:{cartId:cart.id,request:JSON.parse(JSON.stringify(request)) as Prisma.InputJsonValue,priceHash:fingerprint(price),expiresAt}});
      return {id:quote.id,expiresAt,...price};
    });
  }

  place(owner:CartOwner,input:PlaceOrderDto,key:unknown) {
    const scope=owner.kind==='user'?owner.userId:tokenHash(owner.token);
    const requestKey=`order:${scope}:${inventoryKey(key)}`;
    const requestHash=fingerprint({quoteId:input.quoteId,paymentMethod:'COD'});
    return transaction(this.db,async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey},0))`;
      const prior=await tx.order.findUnique({where:{idempotencyKey:requestKey},select:{id:true,requestHash:true}});
      if(prior) {if(prior.requestHash!==requestHash)throw new ConflictException();return orderResponse(await this.ownedOrder(tx,prior.id,owner));}
      const cart=await this.carts.owned(tx,owner);
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE id=${input.quoteId}::uuid FOR UPDATE`;
      const quote=await tx.checkoutSession.findFirst({where:{id:input.quoteId,cartId:cart.id,expiresAt:{gt:await this.now(tx)},order:null}});
      if(!quote)throw new ConflictException();
      const request=quote.request as unknown as QuoteDto;
      await tx.$queryRaw`SELECT id FROM shipping_methods WHERE id=${request.shippingMethodId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM tax_rates WHERE country=${request.shippingAddress.country} ORDER BY id FOR SHARE`;
      await tx.$queryRaw`SELECT c.id FROM coupons c WHERE c.code=${request.couponCode??''} OR EXISTS(SELECT 1 FROM promotions p WHERE p.coupon_id=c.id) ORDER BY c.id FOR UPDATE`;
      const items=await tx.cartItem.findMany({where:{cartId:cart.id},include:{variant:{select:{productId:true}}}});
      const variantIds=items.map(i=>i.variantId).sort();
      const productIds=[...new Set(items.map(i=>i.variant.productId))].sort();
      if(!variantIds.length)throw new ConflictException();
      await tx.$queryRaw`SELECT id FROM products WHERE id IN (${Prisma.join(productIds.map(id=>Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`;
      const locations=await tx.$queryRaw<{id:string}[]>`SELECT l.id FROM inventory_locations l WHERE l.is_active AND EXISTS
        (SELECT 1 FROM inventory_balances b WHERE b.location_id=l.id AND b.variant_id IN (${Prisma.join(variantIds.map(id=>Prisma.sql`${id}::uuid`))})) ORDER BY l.id FOR SHARE`;
      if(!locations.length)throw new ConflictException();
      const balances=await tx.$queryRaw<{variant_id:string;location_id:string;available:number}[]>`SELECT variant_id,location_id,on_hand-reserved AS available FROM inventory_balances
        WHERE variant_id IN (${Prisma.join(variantIds.map(id=>Prisma.sql`${id}::uuid`))}) AND location_id IN (${Prisma.join(locations.map(l=>Prisma.sql`${l.id}::uuid`))}) ORDER BY variant_id,location_id FOR UPDATE`;
      const price=await this.price(tx,owner,cart.id,request);
      if(fingerprint(price)!==quote.priceHash)throw new ConflictException();
      const allocations:{variantId:string;locationId:string;quantity:number}[]=[];
      for(const line of price.items) {
        let remaining=line.quantity;
        for(const balance of balances.filter(b=>b.variant_id===line.variantId)) {
          const quantity=Math.min(remaining,balance.available);
          if(quantity>0)allocations.push({variantId:line.variantId,locationId:balance.location_id,quantity});
          remaining-=quantity;if(!remaining)break;
        }
        if(remaining)throw new ConflictException();
      }
      const now=await this.now(tx);
      const order=await tx.order.create({data:{
        orderNumber:`Z-${randomUUID().replaceAll('-','').toUpperCase()}`,cartId:cart.id,checkoutSessionId:quote.id,
        customerId:owner.kind==='user'?owner.userId:null,guestTokenHash:owner.kind==='guest'?tokenHash(owner.token):null,
        guestAccessExpiresAt:owner.kind==='guest'?new Date(now.getTime()+30*86400000):null,
        idempotencyKey:requestKey,requestHash,shippingName:price.shippingName,taxSnapshot:{country:request.shippingAddress.country,shippingTaxBps:price.shippingTaxBps},
        subtotal:BigInt(price.subtotal),discountTotal:BigInt(price.discountTotal),shippingTotal:BigInt(price.shippingTotal),taxTotal:BigInt(price.taxTotal),grandTotal:BigInt(price.grandTotal),
        addresses:{create:[{kind:'SHIPPING',snapshot:addressSnapshot(request.shippingAddress,request.email)},{kind:'BILLING',snapshot:addressSnapshot(request.billingAddress??request.shippingAddress,request.email)}]},
        history:{create:{status:'CONFIRMED',actorId:owner.kind==='user'?owner.userId:null,reason:'COD order placed'}},
        items:{create:price.items.map(line=>({productId:line.productId,variantId:line.variantId,productName:line.name,sku:line.sku,selection:{size:line.size,color:line.color,taxBps:line.taxBps},quantity:line.quantity,unitPrice:line.unitPrice,discountTotal:BigInt(line.discountTotal),taxTotal:BigInt(line.taxTotal),lineTotal:BigInt(line.lineTotal)}))},
        allocations:{create:allocations},
        ...(price.couponId?{couponRedemption:{create:{couponId:price.couponId,customerId:owner.kind==='user'?owner.userId:null}}}:{}),
      }});
      for(const allocation of allocations) {
        const changed=await tx.$executeRaw`UPDATE inventory_balances SET on_hand=on_hand-${allocation.quantity},updated_at=clock_timestamp()
          WHERE variant_id=${allocation.variantId}::uuid AND location_id=${allocation.locationId}::uuid AND on_hand-reserved>=${allocation.quantity}`;
        if(changed!==1)throw new ConflictException();
        await tx.stockMovement.create({data:{variantId:allocation.variantId,locationId:allocation.locationId,actorId:owner.kind==='user'?owner.userId:null,type:'COMMIT',quantityDelta:-allocation.quantity,reservedDelta:0,reason:`COD order ${order.orderNumber}`,idempotencyKey:`order:${order.id}:${allocation.variantId}:${allocation.locationId}:commit`}});
      }
      await tx.cartItem.deleteMany({where:{cartId:cart.id}});
      await tx.checkoutSession.update({where:{id:quote.id},data:{request:{consumed:true}}});
      await tx.cart.update({where:{id:cart.id},data:{expiresAt:new Date(now.getTime()+30*86400000)}});
      await tx.outboxEvent.create({data:{eventType:'order.confirmed',aggregateId:order.id,payload:{orderId:order.id}}});
      await this.audit(tx,owner.kind==='user'?owner.userId:null,'order.create',order.id);
      return orderResponse(await this.load(tx,order.id));
    });
  }

  list(owner:CartOwner,query:OrderQueryDto) {return this.listWhere(query,owner);}
  adminList(query:OrderQueryDto) {return this.listWhere(query);}
  private listWhere(query:OrderQueryDto,owner?:CartOwner) {
    return transaction(this.db,async tx=>{
      const where={...(owner?this.ownerWhere(owner,await this.now(tx)):{}),...(query.status?{status:query.status}:{})};
      const orders=await tx.order.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:query.limit,skip:(query.page-1)*query.limit,include:orderInclude});
      return {items:orders.map(orderResponse),total:await tx.order.count({where})};
    });
  }
  detail(owner:CartOwner,id:string) {return transaction(this.db,async tx=>orderResponse(await this.ownedOrder(tx,id,owner)));}
  adminDetail(id:string) {return transaction(this.db,async tx=>orderResponse(await this.load(tx,id)));}

  expireQuotes(limit=100) {return this.db.$executeRaw`WITH expired AS (
    SELECT q.id FROM checkout_sessions q WHERE q.expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.checkout_session_id=q.id)
    ORDER BY q.expires_at,q.id LIMIT ${limit} FOR UPDATE SKIP LOCKED
  ) DELETE FROM checkout_sessions q USING expired e WHERE q.id=e.id`;}

  cancel(id:string,reason:string,actorId:string|null,owner?:CartOwner) {
    return transaction(this.db,async tx=>{
      const order=await this.orderLock(tx,id);
      if(owner)await this.ownedOrder(tx,id,owner);
      if(order.status==='CANCELLED')return orderResponse(order);
      if(!['CONFIRMED','PROCESSING'].includes(order.status)||order.paymentStatus!=='PENDING')throw new ConflictException();
      const redemption=await tx.couponRedemption.findUnique({where:{orderId:id}});
      if(redemption)await tx.$queryRaw`SELECT id FROM coupons WHERE id=${redemption.couponId}::uuid FOR UPDATE`;
      const allocations=await tx.orderAllocation.findMany({where:{orderId:id},orderBy:[{variantId:'asc'},{locationId:'asc'}]});
      for(const allocation of allocations) {
        const changed=await tx.$executeRaw`UPDATE inventory_balances SET on_hand=on_hand+${allocation.quantity},updated_at=clock_timestamp()
          WHERE variant_id=${allocation.variantId}::uuid AND location_id=${allocation.locationId}::uuid AND on_hand::bigint+${allocation.quantity}<=2147483647`;
        if(changed!==1)throw new ConflictException();
        await tx.stockMovement.create({data:{variantId:allocation.variantId,locationId:allocation.locationId,actorId,type:'RETURN',quantityDelta:allocation.quantity,reservedDelta:0,reason:`Cancelled order ${order.orderNumber}`,idempotencyKey:`order:${id}:${allocation.variantId}:${allocation.locationId}:cancel`}});
      }
      await tx.order.update({where:{id},data:{status:'CANCELLED',fulfillmentStatus:'CANCELLED'}});
      await tx.couponRedemption.updateMany({where:{orderId:id,releasedAt:null},data:{releasedAt:await this.now(tx)}});
      await tx.orderStatusHistory.create({data:{orderId:id,status:'CANCELLED',actorId,reason}});
      await this.audit(tx,actorId,'order.cancel',id);
      return orderResponse(await this.load(tx,id));
    });
  }

  status(id:string,dto:OrderStatusDto,actorId:string) {
    return transaction(this.db,async tx=>{
      const order=await this.orderLock(tx,id);
      if(order.status===dto.status)return orderResponse(order);
      const next:Record<string,string>={CONFIRMED:'PROCESSING',PROCESSING:'SHIPPED',SHIPPED:'DELIVERED'};
      if(next[order.status]!==dto.status)throw new ConflictException();
      if(dto.status==='SHIPPED') await tx.shipment.create({data:{orderId:id,carrier:dto.carrier!,trackingNumber:dto.trackingNumber!,status:'SHIPPED',events:{create:{status:'SHIPPED'}}}});
      if(dto.status==='DELIVERED') {
        const shipment=await tx.shipment.findUniqueOrThrow({where:{orderId:id}});
        await tx.shipment.update({where:{id:shipment.id},data:{status:'DELIVERED',events:{create:{status:'DELIVERED'}}}});
      }
      await tx.order.update({where:{id},data:{status:dto.status,fulfillmentStatus:dto.status}});
      await tx.orderStatusHistory.create({data:{orderId:id,status:dto.status,actorId,reason:dto.reason}});
      await tx.outboxEvent.create({data:{eventType:`order.${dto.status.toLowerCase()}`,aggregateId:id,payload:{orderId:id}}});
      await this.audit(tx,actorId,'order.status',id);
      return orderResponse(await this.load(tx,id));
    });
  }

  collectCash(id:string,actorId:string) {
    return transaction(this.db,async tx=>{
      const order=await this.orderLock(tx,id);
      if(order.paymentStatus==='PAID')return orderResponse(order);
      if(order.status!=='DELIVERED'||order.paymentStatus!=='PENDING')throw new ConflictException();
      await tx.paymentTransaction.create({data:{orderId:id,kind:'CAPTURE',amount:order.grandTotal,idempotencyKey:`order:${id}:cod-collect`}});
      await tx.order.update({where:{id},data:{paymentStatus:'PAID',paidAt:await this.now(tx)}});
      await this.audit(tx,actorId,'payment.cash_collected',id);
      return orderResponse(await this.load(tx,id));
    });
  }

  refundCash(id:string,dto:RefundDto,key:unknown,actorId:string) {
    const requestKey=`order:${id}:cash-refund:${inventoryKey(key)}`;
    return transaction(this.db,async tx=>{
      const order=await this.orderLock(tx,id);
      const previous=await tx.refund.findUnique({where:{idempotencyKey:requestKey}});
      if(previous) {if(previous.amount!==BigInt(dto.amount)||previous.reason!==dto.reason)throw new ConflictException();return orderResponse(order);}
      if(!['PAID','PARTIALLY_REFUNDED'].includes(order.paymentStatus))throw new ConflictException();
      const total=order.refunds.reduce((sum,refund)=>sum+refund.amount,0n)+BigInt(dto.amount);
      if(total>order.grandTotal)throw new ConflictException();
      await tx.refund.create({data:{orderId:id,amount:BigInt(dto.amount),reason:dto.reason,actorId,idempotencyKey:requestKey}});
      await tx.paymentTransaction.create({data:{orderId:id,kind:'REFUND',amount:BigInt(dto.amount),idempotencyKey:requestKey}});
      await tx.order.update({where:{id},data:{paymentStatus:total===order.grandTotal?'REFUNDED':'PARTIALLY_REFUNDED'}});
      await this.audit(tx,actorId,'payment.cash_refund_recorded',id);
      return orderResponse(await this.load(tx,id));
    });
  }
}
