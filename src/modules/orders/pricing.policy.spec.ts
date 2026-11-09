import { describe, expect, it } from 'vitest';
import { bps, calculatePrice, cents, type PriceLine } from './pricing.policy.js';
const shipping={fee:100,freeAbove:null,shippingTaxBps:500};
function line(id:string,price:number,extra:Partial<PriceLine>={}):PriceLine {return {variantId:id,productId:id,name:'Item',sku:id,quantity:1,unitPrice:price,size:'M',color:{name:'Black',value:'#000000'},taxBps:1000,eligible:true,...extra};}
describe('checkout money policy',()=>{
  it('rounds half cents up with integer arithmetic',()=>{expect(bps(5n,1000)).toBe(1n);expect(bps(4n,1000)).toBe(0n);expect(bps(999999999999999n,9999)).toBe(999899999999999n);});
  it('distributes every discount cent, excludes ineligible lines and taxes discounted totals',()=>{
    const result=calculatePrice([line('a',101),line('b',101),line('c',100,{eligible:false})],shipping,{kind:'FIXED',value:101});
    expect(result.items.map(i=>i.discountTotal)).toEqual([51,50,0]);
    expect(result).toMatchObject({subtotal:302,discountTotal:101,shippingTotal:100,taxTotal:25,grandTotal:326});
    expect(result.items.map(i=>i.lineTotal)).toEqual([55,56,110]);
  });
  it('caps coupons at eligible subtotal and never discounts shipping',()=>{
    expect(calculatePrice([line('a',10),line('b',100,{eligible:false})],shipping,{kind:'FIXED',value:1000})).toMatchObject({discountTotal:10,grandTotal:215});
  });
  it('uses the discounted merchandise amount for free shipping eligibility',()=>{
    expect(calculatePrice([line('a',1000)],{...shipping,freeAbove:1000},{kind:'PERCENTAGE',value:1000})).toMatchObject({discountTotal:100,shippingTotal:100,grandTotal:1095});
    expect(calculatePrice([line('a',1000)],{...shipping,freeAbove:1000})).toMatchObject({shippingTotal:0,taxTotal:100,grandTotal:1100});
  });
  it('supports zero-price merchandise and rejects unsafe output totals',()=>{
    expect(calculatePrice([line('a',0)],shipping,{kind:'PERCENTAGE',value:1000}).discountTotal).toBe(0);
    expect(()=>cents(BigInt(Number.MAX_SAFE_INTEGER)+1n)).toThrow();expect(()=>cents(-1n)).toThrow();
  });
  it('preserves the grand total and allocation identities across cart sizes',()=>{
    for(let count=1;count<=50;count++) {
      const result=calculatePrice(Array.from({length:count},(_,i)=>line(String(i),i*103+1,{quantity:(i%9)+1,eligible:i%3!==0})),shipping,{kind:'PERCENTAGE',value:3333});
      expect(result.items.reduce((s,i)=>s+i.discountTotal,0)).toBe(result.discountTotal);
      expect(result.grandTotal).toBe(result.subtotal-result.discountTotal+result.shippingTotal+result.taxTotal);
      expect(result.items.every(i=>i.lineTotal>=0&&i.discountTotal<=i.unitPrice*i.quantity)).toBe(true);
    }
  });
});
