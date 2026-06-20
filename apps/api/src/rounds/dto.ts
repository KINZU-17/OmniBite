import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class AddItemDto {
  @IsString()
  menuItemId!: string;

  @IsString()
  participantId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  modifierIds?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}
