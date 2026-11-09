import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomerFeaturesService } from './customer.service.js';
import type { PrismaService } from '../../database/prisma.service.js';
describe('customer ownership and verified reviews',()=>{
  it('scopes address updates to the authenticated owner',async()=>{
    const tx={$queryRaw:vi.fn(),address:{updateMany:vi.fn().mockResolvedValue({count:0})}};
    const service=new CustomerFeaturesService({$transaction:(work:(client:typeof tx)=>Promise<unknown>)=>work(tx)} as unknown as PrismaService);
    await expect(service.addressSave('current-user',{firstName:'Test',lastName:'User',phone:'+923001234567',line1:'Street',city:'Lahore',country:'PK'},'other-address')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.address.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:'other-address',userId:'current-user'}}));
  });
  it('requires a delivered, paid order belonging to the review author',async()=>{
    const tx={order:{findFirst:vi.fn().mockResolvedValue(null)},productReview:{create:vi.fn()}};
    const service=new CustomerFeaturesService({$transaction:(work:(client:typeof tx)=>Promise<unknown>)=>work(tx)} as unknown as PrismaService);
    await expect(service.review('current-user',{productId:'product',rating:5,title:'Good item',body:'Verified review body'})).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{customerId:'current-user',status:'DELIVERED',paidAt:{not:null},items:{some:{productId:'product'}}}}));
    expect(tx.productReview.create).not.toHaveBeenCalled();
  });
});
