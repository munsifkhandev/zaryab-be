import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, Permissions, Roles } from '../auth/auth.metadata.js';
import type { AuthContext } from '../auth/auth.types.js';
import { PageQueryDto } from '../catalog/catalog.dto.js';
import { AccountQueryDto, AccountRolesDto, AccountStatusDto, RolePermissionsDto, SalesQueryDto } from './admin.dto.js';
import { AdministrationService } from './admin.service.js';
const uuid=new ParseUUIDPipe({version:'4'});
@ApiCookieAuth() @ApiTags('Administration') @Controller('admin')
export class AdministrationController {
  constructor(@Inject(AdministrationService) private readonly service:AdministrationService) {}
  @Get('customers') @Permissions('customers.read') customers(@Query() q:AccountQueryDto) {return this.service.accounts(q,true);}
  @Get('customers/:id') @Permissions('customers.read') customer(@Param('id',uuid) id:string) {return this.service.customer(id);}
  @Patch('customers/:id/status') @Permissions('customers.update') customerStatus(@Param('id',uuid) id:string,@Body() d:AccountStatusDto,@CurrentAuth() a:AuthContext) {return this.service.status(id,d,a.user.id,true);}
  @Get('users') @Roles('SUPER_ADMIN') @Permissions('users.manage') users(@Query() q:AccountQueryDto) {return this.service.accounts(q,false);}
  @Patch('users/:id/status') @Roles('SUPER_ADMIN') @Permissions('users.manage') status(@Param('id',uuid) id:string,@Body() d:AccountStatusDto,@CurrentAuth() a:AuthContext) {return this.service.status(id,d,a.user.id,false);}
  @Put('users/:id/roles') @Roles('SUPER_ADMIN') @Permissions('users.manage') assign(@Param('id',uuid) id:string,@Body() d:AccountRolesDto,@CurrentAuth() a:AuthContext) {return this.service.assign(id,d.roles,a.user.id);}
  @Get('roles') @Roles('SUPER_ADMIN') @Permissions('roles.manage') roles() {return this.service.roles();}
  @Get('permissions') @Roles('SUPER_ADMIN') @Permissions('roles.manage') permissions() {return this.service.permissions();}
  @Put('roles/:id/permissions') @Roles('SUPER_ADMIN') @Permissions('roles.manage') rolePermissions(@Param('id',uuid) id:string,@Body() d:RolePermissionsDto,@CurrentAuth() a:AuthContext) {return this.service.rolePermissions(id,d.permissions,a.user.id);}
  @Get('audit-logs') @Roles('SUPER_ADMIN') @Permissions('users.manage') audit(@Query() q:PageQueryDto) {return this.service.audit(q);}
  @Get('outbox-events') @Roles('SUPER_ADMIN') @Permissions('users.manage') outbox(@Query() q:PageQueryDto) {return this.service.outbox(q);}
  @Get(['analytics','dashboard/summary']) @Permissions('analytics.read') analytics() {return this.service.analytics();}
  @Get('dashboard/sales') @Permissions('analytics.read') sales(@Query() q:SalesQueryDto) {return this.service.sales(q.days);}
  @Get('dashboard/recent-orders') @Permissions('analytics.read') recent() {return this.service.recentOrders();}
  @Get('dashboard/top-products') @Permissions('analytics.read') top() {return this.service.topProducts();}
  @Get('dashboard/low-stock') @Permissions('analytics.read') lowStock() {return this.service.lowStock();}
}
