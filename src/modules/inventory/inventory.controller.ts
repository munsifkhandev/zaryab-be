import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, Permissions } from '../auth/auth.metadata.js';
import type { AuthContext } from '../auth/auth.types.js';
import { AdjustmentDto, ExpiryBatchDto, InventoryLocationDto, InventoryQueryDto, LocationStatusDto, ReservationDto, ReservationQueryDto, ThresholdDto } from './inventory.dto.js';
import { PageQueryDto } from '../catalog/catalog.dto.js';
import { InventoryService } from './inventory.service.js';
import { ExpiryResponseDto, InventoryListResponseDto, LocationResponseDto, MovementListResponseDto, MovementResponseDto, ReservationListResponseDto, ReservationResponseDto, StockBalanceResponseDto } from './inventory-response.dto.js';

const uuid = new ParseUUIDPipe({ version: '4' });

@ApiCookieAuth()
@ApiTags('Admin inventory')
@Controller('admin/inventory')
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @Get() @Permissions('inventory.read')
  @ApiOkResponse({ type: InventoryListResponseDto })
  balances(@Query() query: InventoryQueryDto) { return this.inventory.balances(query); }

  @Get('low-stock') @Permissions('inventory.read')
  @ApiOkResponse({ type: InventoryListResponseDto })
  low(@Query() query: InventoryQueryDto) { return this.inventory.balances(query, true); }

  @Get('movements') @Permissions('inventory.read')
  @ApiOkResponse({ type: MovementListResponseDto })
  movements(@Query() query: InventoryQueryDto) { return this.inventory.movements(query); }

  @Get('locations') @Permissions('inventory.read')
  @ApiOkResponse({ type: LocationResponseDto, isArray: true })
  locations(@Query() query: PageQueryDto) { return this.inventory.locations(query); }

  @Post('locations') @Permissions('inventory.adjust')
  @ApiCreatedResponse({ type: LocationResponseDto })
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  createLocation(@Body() dto: InventoryLocationDto, @CurrentAuth() auth: AuthContext) { return this.inventory.createLocation(dto, auth.user.id); }

  @Patch('locations/:id/status') @Permissions('inventory.adjust')
  @ApiOkResponse({ type: LocationResponseDto })
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  status(@Param('id', uuid) id: string, @Body() dto: LocationStatusDto, @CurrentAuth() auth: AuthContext) { return this.inventory.locationStatus(id, dto.isActive, auth.user.id); }

  @Patch(':variantId/locations/:locationId/threshold') @Permissions('inventory.adjust')
  @ApiOkResponse({ type: StockBalanceResponseDto })
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  threshold(@Param('variantId', uuid) variantId: string, @Param('locationId', uuid) locationId: string, @Body() dto: ThresholdDto, @CurrentAuth() auth: AuthContext) {
    return this.inventory.threshold(variantId, locationId, dto.lowStockThreshold, auth.user.id);
  }

  @Post('adjustments') @Permissions('inventory.adjust')
  @ApiCreatedResponse({ type: MovementResponseDto })
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true }) @ApiHeader({ name: 'Idempotency-Key', required: true })
  adjust(@Body() dto: AdjustmentDto, @Headers('idempotency-key') key: string | undefined, @CurrentAuth() auth: AuthContext) { return this.inventory.adjust(dto, key, auth.user.id); }

  @Post('reservations') @Permissions('inventory.adjust')
  @ApiCreatedResponse({ type: ReservationResponseDto })
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true }) @ApiHeader({ name: 'Idempotency-Key', required: true })
  reserve(@Body() dto: ReservationDto, @Headers('idempotency-key') key: string | undefined, @CurrentAuth() auth: AuthContext) { return this.inventory.reserve(dto, key, auth.user.id); }

  @Get('reservations') @Permissions('inventory.read')
  @ApiOkResponse({ type: ReservationListResponseDto })
  reservations(@Query() query: ReservationQueryDto) { return this.inventory.reservations(query); }

  @Get('reservations/:id') @Permissions('inventory.read')
  @ApiOkResponse({ type: ReservationResponseDto })
  reservation(@Param('id', uuid) id: string) { return this.inventory.reservation(id); }

  @Post('reservations/expire') @HttpCode(200) @Permissions('inventory.adjust')
  @ApiOkResponse({ type: ExpiryResponseDto })
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  expire(@Body() dto: ExpiryBatchDto) { return this.inventory.expireBatch(dto.limit); }

  @Post('reservations/:id/commit') @HttpCode(200) @Permissions('inventory.adjust')
  @ApiOkResponse({ type: ReservationResponseDto })
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  commit(@Param('id', uuid) id: string, @CurrentAuth() auth: AuthContext) { return this.inventory.commit(id, auth.user.id); }

  @Post('reservations/:id/release') @HttpCode(200) @Permissions('inventory.adjust')
  @ApiOkResponse({ type: ReservationResponseDto })
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  release(@Param('id', uuid) id: string, @CurrentAuth() auth: AuthContext) { return this.inventory.release(id, auth.user.id); }
}
