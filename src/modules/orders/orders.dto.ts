import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsAscii, IsBoolean, IsDateString, IsDefined, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { PageQueryDto } from '../catalog/catalog.dto.js';

export class AddressInputDto {
  @ApiProperty({ type: String }) @Transform(({value}:{value:unknown})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,100) firstName!: string;
  @ApiProperty({ type: String }) @Transform(({value}:{value:unknown})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,100) lastName!: string;
  @ApiProperty({ type: String }) @IsString() @Matches(/^\+?[0-9][0-9 ()-]{4,31}$/) phone!: string;
  @ApiProperty({ type: String }) @IsString() @Length(1,255) line1!: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @Length(0,255) line2?: string;
  @ApiProperty({ type: String }) @IsString() @Length(1,100) city!: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @Length(0,100) region?: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @Length(0,32) postalCode?: string;
  @ApiProperty({ type: String }) @Matches(/^[A-Z]{2}$/) country!: string;
}

export class QuoteDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('4') shippingMethodId!: string;
  @ApiProperty({ type: String, format: 'email' })
  @Transform(({value}:{value:unknown}) => typeof value==='string'?value.trim().toLowerCase():value)
  @IsAscii() @IsEmail({ allow_utf8_local_part:false }) @Length(3,254) email!: string;
  @ApiProperty({ type: AddressInputDto }) @IsDefined() @ValidateNested() @Type(() => AddressInputDto) shippingAddress!: AddressInputDto;
  @ApiPropertyOptional({ type: AddressInputDto }) @IsOptional() @ValidateNested() @Type(() => AddressInputDto) billingAddress?: AddressInputDto;
  @ApiPropertyOptional({ type: String })
  @Transform(({value}:{value:unknown}) => typeof value==='string'?value.trim().toUpperCase():value)
  @IsOptional() @Matches(/^[A-Z0-9_-]{2,64}$/) couponCode?: string;
}

export class PlaceOrderDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('4') quoteId!: string;
}

export class OrderQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum:['CONFIRMED','PROCESSING','SHIPPED','DELIVERED','CANCELLED'] })
  @IsOptional() @IsIn(['CONFIRMED','PROCESSING','SHIPPED','DELIVERED','CANCELLED'])
  status?: 'CONFIRMED'|'PROCESSING'|'SHIPPED'|'DELIVERED'|'CANCELLED';
}

export class OrderStatusDto {
  @ApiProperty({ enum:['PROCESSING','SHIPPED','DELIVERED'] }) @IsIn(['PROCESSING','SHIPPED','DELIVERED']) status!: 'PROCESSING'|'SHIPPED'|'DELIVERED';
  @ApiProperty({ type:String }) @IsString() @Length(5,500) reason!: string;
  @ApiPropertyOptional({ type:String }) @ValidateIf((o:OrderStatusDto)=>o.status==='SHIPPED'||o.carrier!==undefined) @IsString() @Length(1,100) carrier?: string;
  @ApiPropertyOptional({ type:String }) @ValidateIf((o:OrderStatusDto)=>o.status==='SHIPPED'||o.trackingNumber!==undefined) @IsString() @Length(1,150) trackingNumber?: string;
}

export class ReasonDto {
  @ApiProperty({ type:String }) @IsString() @Length(5,500) reason!: string;
}
export class RefundDto extends ReasonDto {
  @ApiProperty({ type:Number, description:'Integer USD cents physically refunded.' }) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) amount!: number;
}

export class ShippingMethodDto {
  @ApiProperty({ type:String }) @IsString() @Length(1,100) name!: string;
  @ApiProperty({ type:[String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @Matches(/^[A-Z]{2}$/, {each:true}) countries!: string[];
  @ApiProperty({ type:Number }) @IsInt() @Min(0) @Max(1000000000) fee!: number;
  @ApiPropertyOptional({ type:Number, nullable:true }) @IsOptional() @IsInt() @Min(0) @Max(1000000000) freeAbove?: number|null;
  @ApiProperty({ type:Number }) @IsInt() @Min(0) @Max(10000) shippingTaxBps!: number;
  @ApiProperty({ type:Boolean }) @IsBoolean() isActive!: boolean;
}
export class UpdateShippingMethodDto extends PartialType(ShippingMethodDto,{skipNullProperties:false}) {}
export class TaxRateDto {
  @ApiProperty({ type:String }) @Matches(/^[A-Z]{2}$/) country!: string;
  @ApiProperty({ type:String }) @Matches(/^[A-Z][A-Z0-9_]{0,29}$/) taxClass!: string;
  @ApiProperty({ type:Number }) @IsInt() @Min(0) @Max(10000) rateBps!: number;
}

export class CouponDto {
  @ApiProperty({ type:String }) @Matches(/^[A-Z0-9_-]{2,64}$/) code!: string;
  @ApiProperty({ enum:['PERCENTAGE','FIXED'] }) @IsIn(['PERCENTAGE','FIXED']) kind!: 'PERCENTAGE'|'FIXED';
  @ApiProperty({ type:Number }) @IsInt() @Min(1) @Max(1000000000) value!: number;
  @ApiPropertyOptional({ type:Number }) @ValidateIf((_o,v:unknown)=>v!==undefined) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) minimumSubtotal?: number;
  @ApiPropertyOptional({ type:Number,nullable:true }) @IsOptional() @IsInt() @Min(1) @Max(1000000000) usageLimit?: number|null;
  @ApiPropertyOptional({ type:Number,nullable:true }) @IsOptional() @IsInt() @Min(1) @Max(1000000000) perCustomerLimit?: number|null;
  @ApiProperty({ type:String,format:'date-time' }) @IsDateString() startsAt!: string;
  @ApiPropertyOptional({ type:String,format:'date-time',nullable:true }) @IsOptional() @IsDateString() endsAt?: string|null;
  @ApiProperty({ type:Boolean }) @IsBoolean() isActive!: boolean;
  @ApiPropertyOptional({ type:[String] }) @ValidateIf((_o,v:unknown)=>v!==undefined) @IsArray() @ArrayMaxSize(200) @ArrayUnique() @IsUUID('4',{each:true}) productIds?: string[];
  @ApiPropertyOptional({ type:[String] }) @ValidateIf((_o,v:unknown)=>v!==undefined) @IsArray() @ArrayMaxSize(200) @ArrayUnique() @IsUUID('4',{each:true}) collectionIds?: string[];
}
export class UpdateCouponDto extends PartialType(CouponDto,{skipNullProperties:false}) {}
export class PromotionDto {
  @ApiProperty({type:String,format:'uuid',description:'Coupon rules to apply automatically. Discounts are exclusive; a supplied code takes precedence.'}) @IsUUID('4') couponId!:string;
  @ApiProperty({type:Number,description:'Higher priority wins; ties use promotion ID ascending.'}) @IsInt() @Min(0) @Max(10000) priority!:number;
}
