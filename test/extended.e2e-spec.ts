import 'reflect-metadata';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { configureApp } from '../src/config/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import type { AuthContext } from '../src/modules/auth/auth.types.js';
import { csrfTokenFor, newSessionToken } from '../src/modules/auth/auth.tokens.js';
import { CartService } from '../src/modules/cart/cart.service.js';
import { OrdersModule } from '../src/modules/orders/orders.module.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';
import { CustomerOrdersController } from '../src/modules/orders/orders.controller.js';
import { PlaceOrderDto, QuoteDto } from '../src/modules/orders/orders.dto.js';
import { ForgotPasswordDto } from '../src/modules/auth/dto/recovery.dto.js';
import { RecoveryController } from '../src/modules/auth/recovery.controller.js';
import { AdministrationModule } from '../src/modules/admin/admin.module.js';
import { AdministrationService } from '../src/modules/admin/admin.service.js';
import { AdministrationController } from '../src/modules/admin/admin.controller.js';
import { AccountRolesDto } from '../src/modules/admin/admin.dto.js';
import { ContentModule } from '../src/modules/content/content.module.js';
import { ContentService } from '../src/modules/content/content.service.js';
import { CustomerFeaturesModule } from '../src/modules/customer/customer.module.js';
import { CustomerFeaturesService } from '../src/modules/customer/customer.service.js';

Reflect.defineMetadata('design:paramtypes',[QuoteDto,Object],CustomerOrdersController.prototype,'quote');
Reflect.defineMetadata('design:paramtypes',[ForgotPasswordDto],RecoveryController.prototype,'request');
Reflect.defineMetadata('design:paramtypes',[PlaceOrderDto,String,Object,Object],CustomerOrdersController.prototype,'place');
Reflect.defineMetadata('design:paramtypes',[String,AccountRolesDto,Object],AdministrationController.prototype,'assign');
describe('checkout, content and administration HTTP boundaries',()=>{
  let app:INestApplication,auth:AuthContext,token:string,guest:string;
  const authCookies=new AuthService({} as PrismaService,new ConfigService({NODE_ENV:'test'}));
  const cartCookies=new CartService({} as PrismaService,new ConfigService({NODE_ENV:'test'}));
  const orders={quote:vi.fn(),place:vi.fn(),detail:vi.fn(),adminList:vi.fn()};
  const admin={assign:vi.fn(),analytics:vi.fn(),audit:vi.fn()};
  const content={articles:vi.fn(),article:vi.fn()};
  const customer={addresses:vi.fn()};
  const authentication={cookieName:'zaryab_session',tokenFromRequest:authCookies.tokenFromRequest.bind(authCookies),authenticate:vi.fn()};
  const carts={cookieName:'zaryab_cart',tokenFromRequest:cartCookies.tokenFromRequest.bind(cartCookies),ownerFromRequest:cartCookies.ownerFromRequest.bind(cartCookies),setCookie:vi.fn()};
  beforeEach(async()=>{
    vi.clearAllMocks();token=newSessionToken();guest=newSessionToken();auth={sessionId:randomUUID(),expiresAt:new Date(Date.now()+60000),csrfToken:csrfTokenFor(token),user:{id:randomUUID(),firstName:'Test',lastName:'Customer',email:'test@example.com',phone:null,emailVerifiedAt:null,roles:['CUSTOMER'],permissions:[]}};
    authentication.authenticate.mockImplementation(async(value:string)=>{if(value!==token)throw new UnauthorizedException();return auth;});
    orders.quote.mockResolvedValue({id:randomUUID(),grandTotal:100});orders.place.mockResolvedValue({id:randomUUID(),guestAccessExpiresAt:new Date(Date.now()+86400000)});
    admin.assign.mockResolvedValue({updated:true});content.articles.mockResolvedValue([]);customer.addresses.mockResolvedValue([]);
    const module=await Test.createTestingModule({imports:[ConfigModule.forRoot({isGlobal:true,ignoreEnvFile:true,load:[()=>validateEnvironment({NODE_ENV:'test',DATABASE_URL:'postgresql://localhost/unused'})]}),AuthModule,OrdersModule,AdministrationModule,ContentModule,CustomerFeaturesModule]})
      .overrideProvider(PrismaService).useValue({}).overrideProvider(AuthService).useValue(authentication).overrideProvider(CartService).useValue(carts)
      .overrideProvider(OrdersService).useValue(orders).overrideProvider(AdministrationService).useValue(admin).overrideProvider(ContentService).useValue(content).overrideProvider(CustomerFeaturesService).useValue(customer).compile();
    app=module.createNestApplication({bodyParser:false});configureApp(app);await app.init();
  });
  afterEach(async()=>{await app.close();});
  const origin='http://localhost:3000';
  function headers(){return {Cookie:`zaryab_session=${token}`,Origin:origin,'X-CSRF-Token':auth.csrfToken};}
  function quote(){return {shippingMethodId:randomUUID(),email:'fixture@example.com',shippingAddress:{firstName:'Test',lastName:'User',phone:'+923001234567',line1:'Fixture street',city:'Lahore',country:'PK'}};}
  it('requires identity for checkout and valid guest CSRF before accepting a quote',async()=>{
    await request(app.getHttpServer()).post('/api/v1/customer/checkout/quote').set('Origin',origin).send(quote()).expect(401);
    await request(app.getHttpServer()).post('/api/v1/customer/checkout/quote').set({Cookie:`zaryab_cart=${guest}`,Origin:origin}).send(quote()).expect(403);
    await request(app.getHttpServer()).post('/api/v1/customer/checkout/quote').set({Cookie:`zaryab_cart=${guest}`,Origin:origin,'X-CSRF-Token':csrfTokenFor(guest)}).send(quote()).expect(201);
    expect(orders.quote).toHaveBeenCalledWith({kind:'guest',token:guest},expect.any(QuoteDto));
  });
  it('rejects caller prices, owner IDs and missing nested addresses',async()=>{
    for(const body of [{...quote(),grandTotal:1},{...quote(),customerId:randomUUID()},{...quote(),shippingAddress:undefined},{...quote(),shippingAddress:{...quote().shippingAddress,country:'pk'}}])await request(app.getHttpServer()).post('/api/v1/customer/checkout/quote').set(headers()).send(body).expect(422);
    expect(orders.quote).not.toHaveBeenCalled();
  });
  it('binds order placement to the authenticated owner and carries the intent key',async()=>{
    const body={quoteId:randomUUID()};await request(app.getHttpServer()).post('/api/v1/customer/checkout/orders').set(headers()).set('Idempotency-Key','checkout-intent-1').send(body).expect(201);
    expect(orders.place).toHaveBeenCalledWith({kind:'user',userId:auth.user.id},expect.objectContaining(body),'checkout-intent-1');
  });
  it('denies administrative order access to customer accounts',async()=>{
    await request(app.getHttpServer()).get('/api/v1/admin/orders').set(headers()).expect(403);expect(orders.adminList).not.toHaveBeenCalled();
  });
  it('requires a root role as well as the permission to assign staff roles',async()=>{
    const id=randomUUID();auth.user.permissions=['users.manage'];
    await request(app.getHttpServer()).put(`/api/v1/admin/users/${id}/roles`).set(headers()).send({roles:['STAFF']}).expect(403);
    auth.user.roles=['SUPER_ADMIN'];
    await request(app.getHttpServer()).put(`/api/v1/admin/users/${id}/roles`).set(headers()).send({roles:['STAFF']}).expect(200);
    expect(admin.assign).toHaveBeenCalledWith(id,['STAFF'],auth.user.id);
  });
  it('keeps articles public while addresses require a session',async()=>{
    await request(app.getHttpServer()).get('/api/v1/articles').expect(200);await request(app.getHttpServer()).get('/api/v1/customer/addresses').expect(401);
    await request(app.getHttpServer()).get('/api/v1/customer/addresses').set(headers()).expect(200);expect(customer.addresses).toHaveBeenCalledWith(auth.user.id,expect.anything());
  });
  it('returns unavailable for email features before provider configuration',async()=>{
    await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').set('Origin',origin).send({email:'fixture@example.com'}).expect(503);
  });
});
