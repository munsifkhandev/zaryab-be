import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ColorResponseDto } from '../catalog/catalog-response.dto.js';

class CartProductResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, format: 'uri' }) image!: string;
}

class CartLineResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) variantId!: string;
  @ApiProperty({ type: Number, minimum: 1, maximum: 99 }) quantity!: number;
  @ApiProperty({ type: CartProductResponseDto, nullable: true }) product!: CartProductResponseDto | null;
  @ApiProperty({ type: String, nullable: true }) sku!: string | null;
  @ApiProperty({ type: String, nullable: true }) size!: string | null;
  @ApiProperty({ type: ColorResponseDto, nullable: true }) color!: ColorResponseDto | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Current unit price in integer USD cents.' }) unitPrice!: number | null;
  @ApiProperty({ enum: ['USD'] }) currency!: string;
  @ApiProperty({ type: Number, nullable: true }) lineTotal!: number | null;
  @ApiProperty({ type: Number, minimum: 0, maximum: 99 }) availableQuantity!: number;
  @ApiProperty({ type: Boolean }) available!: boolean;
  @ApiProperty({ enum: ['UNAVAILABLE', 'INSUFFICIENT_STOCK'], nullable: true }) issue!: string | null;
}

export class CartResponseDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) id!: string | null;
  @ApiProperty({ type: [CartLineResponseDto] }) items!: CartLineResponseDto[];
  @ApiProperty({ enum: ['USD'] }) currency!: string;
  @ApiProperty({ type: Number, nullable: true }) subtotal!: number | null;
  @ApiProperty({ type: Number }) itemCount!: number;
  @ApiProperty({ type: Boolean, description: 'Current cart eligibility, not an inventory reservation or completed checkout.' }) canCheckout!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) expiresAt!: string | null;
  @ApiProperty({ type: Boolean }) requiresInitialization!: boolean;
  @ApiProperty({ type: String, nullable: true }) csrfToken!: string | null;
}

export class CartMergeResultDto {
  @ApiProperty({ enum: ['none', 'merged', 'already_merged', 'deferred', 'expired'] }) status!: string;
  @ApiPropertyOptional({ enum: ['CART_LIMIT', 'QUANTITY_LIMIT'] }) reason?: string;
}

export class CartMergeResponseDto {
  @ApiProperty({ type: CartMergeResultDto }) merge!: CartMergeResultDto;
  @ApiProperty({ type: CartResponseDto }) cart!: CartResponseDto;
}
