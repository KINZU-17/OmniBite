import { IsEnum } from 'class-validator';
import { TicketStatus } from '@prisma/client';

export class SetTicketStatusDto {
  /** IN_PREP or READY. SERVED goes through the dedicated serve endpoint. */
  @IsEnum(TicketStatus)
  status!: TicketStatus;
}

export class BumpLineDto {
  @IsEnum(TicketStatus)
  status!: TicketStatus;
}
