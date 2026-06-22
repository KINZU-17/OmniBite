import { IsString, MinLength } from 'class-validator';

export class CreateTableDto {
  @IsString()
  locationId!: string;

  @IsString()
  @MinLength(1)
  tableNumber!: string;
}

export class UpdateTableDto {
  @IsString()
  @MinLength(1)
  tableNumber!: string;
}
