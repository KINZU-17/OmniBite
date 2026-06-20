import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Payment,
  PaymentMethod,
  Prisma,
  RoundItemStatus,
  RoundStatus,
  SettlementMode,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettlementService } from '../gate/settlement.service';
import { MpesaService } from '../mpesa/mpesa.service';
import { money, sum, ZERO } from '../common/money';
import { ConfirmCardDto, SubmitRoundDto } from './dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: SettlementService,
    private readonly mpesa: MpesaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * SUBMITTED -> AWAITING_PAYMENT. Creates one payment request per payer with
   * server-computed amounts (client never sets the amount), then fires the STK
   * pushes for M-Pesa payers. Cash and card stay INITIATED until recorded.
   */
  async createForRound(roundId: string, dto: SubmitRoundDto) {
    const windowSec = this.config.get<number>('PAYMENT_WINDOW_SECONDS', 300);

    const { payments, mpesaToInitiate, tableNumber } = await this.prisma.$transaction(
      async (tx) => {
        const round = await tx.round.findUnique({
          where: { id: roundId },
          include: {
            items: { where: { status: RoundItemStatus.ACTIVE } },
            session: { include: { table: true, participants: true } },
          },
        });
        if (!round) throw new NotFoundException('round not found');
        if (round.status !== RoundStatus.SUBMITTED) {
          throw new BadRequestException(`round is ${round.status}, expected SUBMITTED`);
        }
        if (round.items.length === 0) {
          throw new BadRequestException('round has no items to pay for');
        }

        // Server-computed item totals per participant.
        const totals = new Map<string, Prisma.Decimal>();
        for (const item of round.items) {
          totals.set(
            item.participantId,
            (totals.get(item.participantId) ?? ZERO).add(item.lineTotal),
          );
        }
        const grandTotal = sum(round.items.map((i) => i.lineTotal));

        const toInitiate: Array<{ payment: Payment; phone: string }> = [];
        const created: Payment[] = [];

        if (dto.settlementMode === SettlementMode.SINGLE_PAYER) {
          if (dto.payments.length !== 1) {
            throw new BadRequestException('SINGLE_PAYER requires exactly one payment');
          }
          const inst = dto.payments[0];
          const amount = grandTotal.add(money(inst.tip ?? 0));
          const payment = await tx.payment.create({
            data: {
              roundId,
              participantId: inst.participantId ?? null,
              method: inst.method,
              amount,
            },
          });
          created.push(payment);
          if (inst.method === PaymentMethod.MPESA) {
            const phone = this.resolvePhone(inst.phone, inst.participantId, round.session.participants);
            toInitiate.push({ payment, phone });
          }
        } else {
          // SPLIT: every participant with items must have a payment instruction.
          for (const [participantId, itemTotal] of totals) {
            const inst = dto.payments.find((p) => p.participantId === participantId);
            if (!inst) {
              throw new BadRequestException(`missing payment for participant ${participantId}`);
            }
            const amount = itemTotal.add(money(inst.tip ?? 0));
            const payment = await tx.payment.create({
              data: { roundId, participantId, method: inst.method, amount },
            });
            created.push(payment);
            if (inst.method === PaymentMethod.MPESA) {
              const phone = this.resolvePhone(inst.phone, participantId, round.session.participants);
              toInitiate.push({ payment, phone });
            }
          }
        }

        await tx.round.update({
          where: { id: roundId },
          data: {
            status: RoundStatus.AWAITING_PAYMENT,
            paymentWindowExpiresAt:
              dto.settlementMode === SettlementMode.SPLIT
                ? new Date(Date.now() + windowSec * 1000)
                : null,
          },
        });

        return {
          payments: created,
          mpesaToInitiate: toInitiate,
          tableNumber: round.session.table.tableNumber,
        };
      },
    );

    // Fire STK pushes outside the transaction (network + their own writes).
    for (const { payment, phone } of mpesaToInitiate) {
      await this.mpesa.initiate(payment, phone, tableNumber);
    }
    return payments;
  }

  /** Cash recorded by staff -> CONFIRMED, may fire the round. */
  async confirmCash(paymentId: string): Promise<{ fired: boolean }> {
    const payment = await this.requirePayment(paymentId, PaymentMethod.CASH);
    if (payment.status === 'CONFIRMED') return { fired: false };
    return this.settlement.confirmPayment(paymentId);
  }

  /** Card captured (gateway integration is a Phase 1 stub) -> CONFIRMED. */
  async confirmCard(paymentId: string, dto: ConfirmCardDto): Promise<{ fired: boolean }> {
    const payment = await this.requirePayment(paymentId, PaymentMethod.CARD);
    if (payment.status === 'CONFIRMED') return { fired: false };
    await this.prisma.cardTransaction.upsert({
      where: { paymentId },
      create: { paymentId, gatewayRef: dto.gatewayRef, authCode: dto.authCode },
      update: { gatewayRef: dto.gatewayRef, authCode: dto.authCode },
    });
    return this.settlement.confirmPayment(paymentId);
  }

  /**
   * Retry a failed M-Pesa payment by issuing a fresh payment + STK push (the old
   * mpesa_transactions row is keyed 1:1 to the failed payment, so we never reuse).
   */
  async retryMpesa(paymentId: string, phone?: string): Promise<Payment> {
    const old = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { round: { include: { session: { include: { table: true, participants: true } } } } },
    });
    if (!old) throw new NotFoundException('payment not found');
    if (old.method !== PaymentMethod.MPESA) {
      throw new BadRequestException('only M-Pesa payments are retried this way');
    }
    if (old.status !== 'FAILED') {
      throw new BadRequestException('only a FAILED payment can be retried');
    }

    const fresh = await this.prisma.payment.create({
      data: {
        roundId: old.roundId,
        participantId: old.participantId,
        method: PaymentMethod.MPESA,
        amount: old.amount,
      },
    });
    const resolved = this.resolvePhone(phone, old.participantId, old.round.session.participants);
    await this.mpesa.initiate(fresh, resolved, old.round.session.table.tableNumber);
    return fresh;
  }

  private resolvePhone(
    explicit: string | undefined,
    participantId: string | null | undefined,
    participants: { id: string; phone: string | null }[],
  ): string {
    const phone = explicit ?? participants.find((p) => p.id === participantId)?.phone;
    if (!phone) throw new BadRequestException('no phone number for M-Pesa payment');
    return phone;
  }

  private async requirePayment(id: string, method: PaymentMethod): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('payment not found');
    if (payment.method !== method) {
      throw new BadRequestException(`payment is ${payment.method}, expected ${method}`);
    }
    return payment;
  }
}
