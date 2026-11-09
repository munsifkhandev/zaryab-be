import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageQueryDto } from '../catalog/catalog.dto.js';
import type { RoleName, UserStatus } from '../../generated/prisma/enums.js';
export class AccountQueryDto extends PageQueryDto {
  @ApiPropertyOptional({enum:['ACTIVE','SUSPENDED','ARCHIVED']}) @IsOptional() @IsIn(['ACTIVE','SUSPENDED','ARCHIVED']) status?:UserStatus;
}
export class AccountStatusDto {
  @ApiProperty({enum:['ACTIVE','SUSPENDED','ARCHIVED']}) @IsIn(['ACTIVE','SUSPENDED','ARCHIVED']) status!:UserStatus;
  @ApiProperty({type:String}) @IsString() @Length(5,500) reason!:string;
}
export class AccountRolesDto {
  @ApiProperty({type:[String]}) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @ArrayUnique() @IsIn(['SUPER_ADMIN','ADMIN','STAFF','CUSTOMER'],{each:true}) roles!:RoleName[];
}
export class RolePermissionsDto {
  @ApiProperty({type:[String]}) @IsArray() @ArrayMaxSize(200) @ArrayUnique() @Matches(/^[a-z]+\.[a-z]+$/,{each:true}) permissions!:string[];
}
export class SalesQueryDto {
  @ApiPropertyOptional({type:Number,default:30,description:'UTC calendar days including today, up to 366.'}) @Type(()=>Number) @IsInt() @Min(1) @Max(366) days=30;
}
