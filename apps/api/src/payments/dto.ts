import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod, SettlementMode } from '@prisma/client';

export class PaymentInstructionDto {
  /** The payer. Required in SPLIT mode; optional in SINGLE_PAYER (null = staff cash). */
  @IsOptional()
  @IsString()
  participantId?: string;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  /** Required for MPESA if the participant has no stored phone. */
  @IsOptional()
  @IsString()
  phone?: string;

  /** Tip added on top, paid in the same push. Decimal string, e.g. "100.00". */
  @IsOptional()
  @IsString()
  tip?: string;
}

export class SubmitRoundDto {
  @IsEnum(SettlementMode)
  settlementMode!: SettlementMode;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PaymentInstructionDto)
  payments!: PaymentInstructionDto[];
}

export class ConfirmCardDto {
  @IsString()
  gatewayRef!: string;

  @IsOptional()
  @IsString()
  authCode?: string;
}

export class RetryMpesaDto {
  @IsOptional()
  @IsString()
  phone?: string;
}
