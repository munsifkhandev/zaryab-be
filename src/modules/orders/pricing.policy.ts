import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export function cents(value: bigint): number {
  if (value<0n || value>BigInt(Number.MAX_SAFE_INTEGER)) throw new BadRequestException();
  return Number(value);
}
export function bps(value:bigint, rate:number):bigint { return (value*BigInt(rate)+5000n)/10000n; }
export function fingerprint(value:unknown):string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export type PriceLine = { variantId:string; productId:string; name:string; sku:string; quantity:number; unitPrice:number; size:string; color:{name:string;value:string}; taxBps:number; eligible:boolean };
export function calculatePrice(lines:PriceLine[], shipping:{fee:number;freeAbove:number|null;shippingTaxBps:number}, coupon?:{kind:string;value:number}) {
  const gross=lines.map(line=>BigInt(line.unitPrice)*BigInt(line.quantity));
  const subtotal=gross.reduce((a,b)=>a+b,0n);
  const eligible=gross.reduce((sum,value,i)=>sum+(lines[i].eligible?value:0n),0n);
  let discount=coupon?(coupon.kind==='PERCENTAGE'?bps(eligible,coupon.value):BigInt(coupon.value)):0n;
  if(discount>eligible) discount=eligible;
  const allocated=gross.map((value,i)=>eligible>0n && lines[i].eligible?discount*value/eligible:0n);
  let remainder=discount-allocated.reduce((a,b)=>a+b,0n);
  for(let i=0;i<lines.length && remainder>0n;i++) if(lines[i].eligible && gross[i]>allocated[i]) {allocated[i]++;remainder--;}
  const itemTax=gross.map((value,i)=>bps(value-allocated[i],lines[i].taxBps));
  const shippingTotal=shipping.freeAbove!==null && subtotal-discount>=BigInt(shipping.freeAbove)?0n:BigInt(shipping.fee);
  const taxTotal=itemTax.reduce((a,b)=>a+b,0n)+bps(shippingTotal,shipping.shippingTaxBps);
  return { currency:'USD' as const, subtotal:cents(subtotal), discountTotal:cents(discount), shippingTotal:cents(shippingTotal), taxTotal:cents(taxTotal),
    grandTotal:cents(subtotal-discount+shippingTotal+taxTotal),
    items:lines.map((line,i)=>({...line,discountTotal:cents(allocated[i]),taxTotal:cents(itemTax[i]),lineTotal:cents(gross[i]-allocated[i]+itemTax[i])})) };
}
