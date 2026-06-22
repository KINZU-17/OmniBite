import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class Toggle86Dto {
  @IsBoolean()
  is86!: boolean;
}

/** Admin/manager creates a menu item. itemCode is auto-generated when omitted. */
export class CreateMenuItemDto {
  @IsString()
  locationId!: string;

  @IsString()
  name!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  basePrice!: number;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Image URL or a data: URL from an uploaded photo. */
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  itemCode?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergens?: string[];
}

/** Partial update; any provided field is changed. allergens, if sent, replace. */
export class UpdateMenuItemDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  basePrice?: number;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergens?: string[];
}
