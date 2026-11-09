import { ApiProperty } from '@nestjs/swagger';

export class StockBalanceResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) variantId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) locationId!: string;
  @ApiProperty({ type: Number }) onHand!: number;
  @ApiProperty({ type: Number }) reserved!: number;
  @ApiProperty({ type: Number }) lowStockThreshold!: number;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class InventoryBalanceResponseDto extends StockBalanceResponseDto {
  @ApiProperty({ type: Number }) available!: number;
  @ApiProperty({ type: String }) sku!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) locationName!: string;
  @ApiProperty({ type: Boolean }) isActive!: boolean;
}

export class InventoryListResponseDto {
  @ApiProperty({ type: [InventoryBalanceResponseDto] }) items!: InventoryBalanceResponseDto[];
  @ApiProperty({ type: Number }) total!: number;
}

export class MovementResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) variantId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) locationId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) actorId!: string | null;
  @ApiProperty({ enum: ['ADJUSTMENT', 'RESERVATION', 'RELEASE', 'COMMIT', 'RETURN'] }) type!: string;
  @ApiProperty({ type: Number }) quantityDelta!: number;
  @ApiProperty({ type: Number }) reservedDelta!: number;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ type: String }) idempotencyKey!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class MovementListResponseDto {
  @ApiProperty({ type: [MovementResponseDto] }) items!: MovementResponseDto[];
  @ApiProperty({ type: Number }) total!: number;
}

export class ReservationResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) variantId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) locationId!: string;
  @ApiProperty({ type: Number }) quantity!: number;
  @ApiProperty({ enum: ['ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED'] }) status!: string;
  @ApiProperty({ type: String }) idempotencyKey!: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class ReservationListResponseDto {
  @ApiProperty({ type: [ReservationResponseDto] }) items!: ReservationResponseDto[];
  @ApiProperty({ type: Number }) total!: number;
}

export class LocationResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Boolean }) isActive!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class ExpiryResponseDto {
  @ApiProperty({ type: Number }) expired!: number;
}
