import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ScanDto {
  /** The table's QR token. Validated server-side (signing/rotation is Phase 2). */
  @IsString()
  qrToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}

export class JoinDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}
