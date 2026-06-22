import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface EtimsTransmitPayload {
  docType: 'INVOICE' | 'CREDIT_NOTE';
  sellerPin: string;
  buyerPin?: string | null;
  totalAmount: string;
  taxAmount: string;
  originalInvoiceNo?: string | null; // for credit notes
  lines: Array<{
    description: string;
    itemCode: string;
    quantity: number;
    unitPrice: string;
    taxRate: string;
    taxAmount: string;
  }>;
}

export interface EtimsTransmitResult {
  invoiceNo: string;
  qrData: string;
}

/**
 * eTIMS (KRA) client. OmniBite recommends the OSCU route (always-online) or an
 * accredited integrator exposing a single POST /invoice endpoint. Field names
 * here are the shape, not gospel — confirm against KRA's VSCU/OSCU spec or your
 * integrator before go-live. One hard rule: a credit note must be issued through
 * the same solution that issued the original invoice.
 */
@Injectable()
export class EtimsClient {
  private readonly logger = new Logger(EtimsClient.name);
  private readonly http: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.http = axios.create({
      baseURL: this.config.get<string>('ETIMS_BASE_URL', ''),
      timeout: 30_000,
    });
  }

  get configured(): boolean {
    return !!this.config.get<string>('ETIMS_BASE_URL', '');
  }

  async transmit(payload: EtimsTransmitPayload): Promise<EtimsTransmitResult> {
    if (!this.configured) {
      // Keeps invoices in PENDING/FAILED so the retry worker transmits once the
      // integration is configured — never blocks the kitchen.
      throw new Error('eTIMS not configured (ETIMS_BASE_URL unset)');
    }
    const endpoint =
      payload.docType === 'CREDIT_NOTE' ? '/credit-notes' : '/invoices';
    const res = await this.http.post<{
      invoiceNo?: string;
      fiscalDocumentNumber?: string;
      qrData?: string;
      qrCode?: string;
    }>(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${this.config.get<string>('ETIMS_API_KEY', '')}`,
      },
    });
    return {
      invoiceNo: String(
        res.data.invoiceNo ?? res.data.fiscalDocumentNumber ?? '',
      ),
      qrData: String(res.data.qrData ?? res.data.qrCode ?? ''),
    };
  }
}
