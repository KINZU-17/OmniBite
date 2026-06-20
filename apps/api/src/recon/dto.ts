import { IsOptional, IsString } from 'class-validator';

export class OpenDrawerDto {
  @IsString()
  openingFloat!: string;
}

export class CloseDrawerDto {
  @IsString()
  countedTotal!: string;
}

export class RunReconDto {
  @IsString()
  locationId!: string;

  @IsString()
  statementTotal!: string;

  /** ISO date for the run; defaults to today. */
  @IsOptional()
  @IsString()
  runDate?: string;
}
