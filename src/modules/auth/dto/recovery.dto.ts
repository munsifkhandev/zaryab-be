import { Transform } from 'class-transformer';
import { IsAscii, IsEmail, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class ForgotPasswordDto {
  @ApiProperty({type:String}) @Transform(({value}:{value:unknown})=>typeof value==='string'?value.trim().toLowerCase():value) @IsAscii() @IsEmail({allow_utf8_local_part:false}) @Length(3,254) email!:string;
}
export class TokenDto {
  @ApiProperty({type:String}) @Matches(/^[A-Za-z0-9_-]{43}$/) token!:string;
}
export class ResetPasswordDto extends TokenDto {
  @ApiProperty({type:String,format:'password'}) @IsString() @Length(12,128) password!:string;
}
export class ChangePasswordDto {
  @ApiProperty({type:String,format:'password'}) @IsString() @Length(1,128) currentPassword!:string;
  @ApiProperty({type:String,format:'password'}) @IsString() @Length(12,128) password!:string;
}
