import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { PageQueryDto } from '../catalog/catalog.dto.js';
export class WishlistDto { @ApiProperty({type:String,format:'uuid'}) @IsUUID('4') productId!:string; }
export class ReviewDto extends WishlistDto {
  @ApiProperty({type:Number}) @IsInt() @Min(1) @Max(5) rating!:number;
  @ApiProperty({type:String}) @IsString() @Length(1,200) title!:string;
  @ApiProperty({type:String}) @IsString() @Length(1,2000) body!:string;
}
export class ReviewModerationDto { @ApiProperty({enum:['PUBLISHED','REJECTED']}) @IsIn(['PUBLISHED','REJECTED']) status!:'PUBLISHED'|'REJECTED'; }
export class ReviewQueryDto extends PageQueryDto {
  @ApiPropertyOptional({enum:['PENDING','PUBLISHED','REJECTED']}) @IsOptional() @IsIn(['PENDING','PUBLISHED','REJECTED']) status?:string;
}
