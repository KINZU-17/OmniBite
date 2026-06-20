import { IsIn, IsOptional, IsString } from 'class-validator';

export class RequestRefundDto {
  @IsString()
  paymentId!: string;

  /** Item-level refund. Omit for a whole-payment refund. */
  @IsOptional()
  @IsString()
  roundItemId?: string;

  /** Override amount (decimal string). Defaults to the item or payment total. */
  @IsOptional()
  @IsString()
  amount?: string;

  @IsString()
  reasonCode!: string;
}

export class ResolveRefundDto {
  /** CREDIT (default, instant) or REVERSAL (true M-Pesa reversal, slow). */
  @IsIn(['CREDIT', 'REVERSAL'])
  mode!: 'CREDIT' | 'REVERSAL';
}
