import { Transform } from 'class-transformer';
import { IsAscii, IsEmail, IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ type: String, example: 'customer@example.com', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsAscii()
  @IsEmail({ allow_utf8_local_part: false })
  @Length(3, 254)
  email!: string;

  @ApiProperty({ type: String, format: 'password', maxLength: 128 })
  @IsString()
  @Length(1, 128)
  password!: string;
}

export class RegisterDto extends LoginDto {
  @ApiProperty({ type: String, minLength: 12, maxLength: 128, format: 'password' })
  @Length(12, 128)
  declare password: string;

  @ApiProperty({ type: String, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 100)
  firstName!: string;

  @ApiProperty({ type: String, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 100)
  lastName!: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ type: String, maxLength: 100 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 100)
  firstName?: string;

  @ApiPropertyOptional({ type: String, maxLength: 100 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 100)
  lastName?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 32 })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9][0-9 ()-]{4,31}$/)
  phone?: string | null;
}
