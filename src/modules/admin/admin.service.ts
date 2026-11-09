import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { transaction } from '../../common/database/transaction.js';
import type { RoleName } from '../../generated/prisma/enums.js';
import type { AccountQueryDto, AccountStatusDto } from './admin.dto.js';
import type { PageQueryDto } from '../catalog/catalog.dto.js';
import { cents } from '../orders/pricing.policy.js';
const accountSelect={id:true,firstName:true,lastName:true,email:true,phone:true,status:true,emailVerifiedAt:true,createdAt:true,roles:{select:{role:{select:{name:true}}}}} satisfies Prisma.UserSelect;
const customerOnly={roles:{some:{role:{name:'CUSTOMER' as const}},none:{role:{name:{in:['SUPER_ADMIN','ADMIN','STAFF'] as RoleName[]}}}}};
export function assertAccountChange(actorId:string,targetId:string,isRoot:boolean,activeRoots:number,removingRoot:boolean) {
  if(actorId===targetId)throw new ForbiddenException();
  if(isRoot&&removingRoot&&activeRoots<=1)throw new ConflictException();
}
@Injectable()
export class AdministrationService {
  constructor(@Inject(PrismaService) private readonly db:PrismaService) {}
  accounts(query:AccountQueryDto,customers:boolean) {return transaction(this.db,async tx=>{
    const where={...(customers?customerOnly:{}),...(query.status?{status:query.status}:{})};
    return {items:await tx.user.findMany({where,select:accountSelect,orderBy:[{createdAt:'desc'},{id:'asc'}],take:query.limit,skip:(query.page-1)*query.limit}),total:await tx.user.count({where})};
  });}
  async customer(id:string) {const value=await this.db.user.findFirst({where:{id,...customerOnly},select:accountSelect});if(!value)throw new NotFoundException();return value;}
  private async lockAccounts(tx:Prisma.TransactionClient,id:string) {
    // Serialize root membership/status changes so concurrent requests cannot remove the last root.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('account-administration',0))`;
    await tx.$queryRaw`SELECT id FROM users WHERE id=${id}::uuid FOR UPDATE`;
    const user=await tx.user.findUnique({where:{id},select:accountSelect});if(!user)throw new NotFoundException();return user;
  }
  private async requireRoot(tx:Prisma.TransactionClient,actorId:string) {
    if(!await tx.user.findFirst({where:{id:actorId,status:'ACTIVE',roles:{some:{role:{name:'SUPER_ADMIN'}}}},select:{id:true}}))throw new ForbiddenException();
  }
  status(id:string,dto:AccountStatusDto,actorId:string,customers:boolean) {return transaction(this.db,async tx=>{
    const user=await this.lockAccounts(tx,id);
    if(!customers)await this.requireRoot(tx,actorId);
    const staff=user.roles.some(r=>r.role.name!=='CUSTOMER');
    if(customers&&staff)throw new ForbiddenException();
    if(customers&&!user.roles.some(r=>r.role.name==='CUSTOMER'))throw new NotFoundException();
    const isRoot=user.status==='ACTIVE'&&user.roles.some(r=>r.role.name==='SUPER_ADMIN');
    const roots=await tx.user.count({where:{status:'ACTIVE',roles:{some:{role:{name:'SUPER_ADMIN'}}}}});
    assertAccountChange(actorId,id,isRoot,roots,dto.status!=='ACTIVE');
    const result=await tx.user.update({where:{id},data:{status:dto.status},select:accountSelect});
    await tx.session.updateMany({where:{userId:id,revokedAt:null},data:{revokedAt:new Date()}});
    await tx.auditLog.create({data:{actorId,action:'account.status',entityType:'user',entityId:id,metadata:{status:dto.status,reason:dto.reason}}});return result;
  });}
  roles() {return this.db.role.findMany({include:{permissions:{include:{permission:true}}},orderBy:{name:'asc'}});}
  permissions() {return this.db.permission.findMany({orderBy:{code:'asc'}});}
  assign(id:string,names:RoleName[],actorId:string) {return transaction(this.db,async tx=>{
    const user=await this.lockAccounts(tx,id);
    await this.requireRoot(tx,actorId);
    const roots=await tx.user.count({where:{status:'ACTIVE',roles:{some:{role:{name:'SUPER_ADMIN'}}}}});
    assertAccountChange(actorId,id,user.status==='ACTIVE'&&user.roles.some(r=>r.role.name==='SUPER_ADMIN'),roots,!names.includes('SUPER_ADMIN'));
    const roles=await tx.role.findMany({where:{name:{in:names}}});if(roles.length!==names.length)throw new BadRequestException();
    await tx.userRole.deleteMany({where:{userId:id}});await tx.userRole.createMany({data:roles.map(r=>({userId:id,roleId:r.id}))});
    await tx.session.updateMany({where:{userId:id,revokedAt:null},data:{revokedAt:new Date()}});
    await tx.auditLog.create({data:{actorId,action:'account.roles',entityType:'user',entityId:id,metadata:{roles:names}}});
    return tx.user.findUniqueOrThrow({where:{id},select:accountSelect});
  });}
  rolePermissions(id:string,codes:string[],actorId:string) {return transaction(this.db,async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('account-administration',0))`;
    await this.requireRoot(tx,actorId);
    await tx.$queryRaw`SELECT id FROM roles WHERE id=${id}::uuid FOR UPDATE`;
    const role=await tx.role.findUnique({where:{id}});if(!role)throw new NotFoundException();
    if(role.name==='SUPER_ADMIN'||role.name==='CUSTOMER'||codes.some(c=>['roles.manage','users.manage'].includes(c)))throw new ForbiddenException();
    const permissions=await tx.permission.findMany({where:{code:{in:codes}}});if(permissions.length!==codes.length)throw new BadRequestException();
    await tx.rolePermission.deleteMany({where:{roleId:id}});await tx.rolePermission.createMany({data:permissions.map(p=>({roleId:id,permissionId:p.id}))});
    await tx.auditLog.create({data:{actorId,action:'role.permissions',entityType:'role',entityId:id,metadata:{permissions:codes}}});return {updated:true};
  });}
  audit(q:PageQueryDto) {return this.db.auditLog.findMany({orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.limit,skip:(q.page-1)*q.limit});}
  outbox(q:PageQueryDto) {return this.db.outboxEvent.findMany({select:{id:true,eventType:true,aggregateId:true,status:true,attempts:true,availableAt:true,processedAt:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.limit,skip:(q.page-1)*q.limit});}
  analytics() {return transaction(this.db,async tx=>{
    const [money]=await tx.$queryRaw<{collected:bigint;refunded:bigint}[]>`SELECT COALESCE(SUM(amount) FILTER(WHERE kind='CAPTURE'),0)::bigint AS collected, COALESCE(SUM(amount) FILTER(WHERE kind='REFUND'),0)::bigint AS refunded FROM payment_transactions`;
    const capturedOrders=await tx.paymentTransaction.count({where:{kind:'CAPTURE'}});
    return {currency:'USD',period:'all-time',orders:await tx.order.count(),paidOrders:await tx.order.count({where:{paymentStatus:'PAID'}}),pendingFulfillment:await tx.order.count({where:{status:{in:['CONFIRMED','PROCESSING']}}}),customers:await tx.user.count({where:customerOnly}),activeProducts:await tx.product.count({where:{status:'PUBLISHED'}}),collected:cents(money.collected),refunded:cents(money.refunded),netCollected:cents(money.collected-money.refunded),averageCollectedOrder:capturedOrders?cents(money.collected/BigInt(capturedOrders)):0,stock:await tx.inventoryBalance.aggregate({_sum:{onHand:true,reserved:true}})};
  });}
  async sales(days:number) {
    const since=new Date();since.setUTCHours(0,0,0,0);since.setUTCDate(since.getUTCDate()-(days-1));
    const rows=await this.db.$queryRaw<{day:string;collected:bigint;refunded:bigint}[]>`SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day, COALESCE(SUM(amount) FILTER(WHERE kind='CAPTURE'),0)::bigint AS collected, COALESCE(SUM(amount) FILTER(WHERE kind='REFUND'),0)::bigint AS refunded FROM payment_transactions WHERE created_at>=${since} GROUP BY 1 ORDER BY 1`;
    return {currency:'USD',from:since,days,items:rows.map(r=>({day:r.day,collected:cents(r.collected),refunded:cents(r.refunded),netCollected:signedCents(r.collected-r.refunded)}))};
  }
  async recentOrders() {return (await this.db.order.findMany({select:{id:true,orderNumber:true,status:true,paymentStatus:true,grandTotal:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:10})).map(o=>({...o,grandTotal:cents(o.grandTotal)}));}
  async topProducts() {
    const rows=await this.db.$queryRaw<{productId:string;name:string;units:bigint}[]>`SELECT i.product_id AS "productId", MAX(i.product_name) AS name, SUM(i.quantity)::bigint AS units FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status='DELIVERED' AND o.paid_at IS NOT NULL GROUP BY i.product_id ORDER BY units DESC,i.product_id LIMIT 20`;
    return rows.map(r=>({...r,units:cents(r.units)}));
  }
  lowStock() {return this.db.$queryRaw`SELECT b.variant_id AS "variantId", b.location_id AS "locationId", v.sku, b.on_hand-b.reserved AS available, b.low_stock_threshold AS threshold FROM inventory_balances b JOIN inventory_locations l ON l.id=b.location_id JOIN product_variants v ON v.id=b.variant_id WHERE l.is_active AND v.status='ACTIVE' AND b.on_hand-b.reserved<=b.low_stock_threshold ORDER BY available,b.variant_id,b.location_id LIMIT 20`;}
}
function signedCents(value:bigint):number {const absolute=value<0n?-value:value;return (value<0n?-1:1)*cents(absolute);}
