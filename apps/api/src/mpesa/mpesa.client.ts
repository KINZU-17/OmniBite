import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/**
 * Daraja (M-Pesa) HTTP client. Caches the OAuth token (valid ~1h) and refreshes
 * on expiry rather than fetching one per request.
 *
 * CAVEAT: exact field names and result codes are the shape, not gospel — confirm
 * against Safaricom's current Daraja docs before go-live. They are all confined
 * to this file so reconciliation is a single edit.
 */
@Injectable()
export class MpesaClient {
  private readonly logger = new Logger(MpesaClient.name);
  private readonly http: AxiosInstance;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {
    this.http = axios.create({
      baseURL: this.config.get<string>(
        'MPESA_BASE_URL',
        'https://sandbox.safaricom.co.ke',
      ),
      timeout: 30_000,
    });
  }

  private get shortcode(): string {
    return this.config.get<string>('MPESA_SHORTCODE', '');
  }
  private get passkey(): string {
    return this.config.get<string>('MPESA_PASSKEY', '');
  }

  /** Nairobi (UTC+3, no DST) timestamp: yyyyMMddHHmmss. */
  private timestamp(): string {
    const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
      `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
    );
  }

  private password(timestamp: string): string {
    return Buffer.from(`${this.shortcode}${this.passkey}${timestamp}`).toString(
      'base64',
    );
  }

  async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }
    const key = this.config.get<string>('MPESA_CONSUMER_KEY', '');
    const secret = this.config.get<string>('MPESA_CONSUMER_SECRET', '');
    const basic = Buffer.from(`${key}:${secret}`).toString('base64');

    const res = await this.http.get<{
      access_token: string;
      expires_in?: number;
    }>('/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: `Basic ${basic}` },
    });
    const value = res.data.access_token;
    const ttl = Number(res.data.expires_in ?? 3599) * 1000;
    this.token = { value, expiresAt: Date.now() + ttl };
    return value;
  }

  private async authHeaders() {
    return { Authorization: `Bearer ${await this.getToken()}` };
  }

  /** Lipa na M-Pesa Online (STK push). Returns the synchronous acceptance body. */
  async stkPush(params: {
    amount: number;
    phone: string;
    accountReference: string;
    description: string;
  }): Promise<{
    MerchantRequestID?: string;
    CheckoutRequestID?: string;
    ResponseCode?: string;
  }> {
    const timestamp = this.timestamp();
    const txType = this.config.get<string>(
      'MPESA_TX_TYPE',
      'CustomerPayBillOnline',
    );
    const body = {
      BusinessShortCode: this.shortcode,
      Password: this.password(timestamp),
      Timestamp: timestamp,
      TransactionType: txType,
      Amount: params.amount,
      PartyA: params.phone,
      PartyB: this.shortcode,
      PhoneNumber: params.phone,
      CallBackURL: this.config.get<string>('MPESA_CALLBACK_URL', ''),
      AccountReference: params.accountReference.slice(0, 12),
      TransactionDesc: params.description.slice(0, 13),
    };
    const res = await this.http.post<{
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResponseCode?: string;
    }>('/mpesa/stkpush/v1/processrequest', body, {
      headers: await this.authHeaders(),
    });
    return res.data;
  }

  /** Status-query backstop for a dropped callback. */
  async stkQuery(
    checkoutRequestId: string,
  ): Promise<{ ResultCode?: string; ResultDesc?: string }> {
    const timestamp = this.timestamp();
    const body = {
      BusinessShortCode: this.shortcode,
      Password: this.password(timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    };
    const res = await this.http.post<{
      ResultCode?: string;
      ResultDesc?: string;
    }>('/mpesa/stkpushquery/v1/query', body, {
      headers: await this.authHeaders(),
    });
    return res.data;
  }

  /** Reversal — operationally heavy; store credit is OmniBite's default remedy. */
  async reversal(params: {
    transactionId: string;
    amount: number;
    receiver: string;
  }): Promise<unknown> {
    const body = {
      Initiator: this.config.get<string>('MPESA_INITIATOR', ''),
      SecurityCredential: this.config.get<string>(
        'MPESA_SECURITY_CREDENTIAL',
        '',
      ),
      CommandID: 'TransactionReversal',
      TransactionID: params.transactionId,
      Amount: params.amount,
      ReceiverParty: params.receiver,
      RecieverIdentifierType: '11',
      ResultURL: this.config.get<string>('MPESA_REVERSAL_RESULT_URL', ''),
      QueueTimeOutURL: this.config.get<string>(
        'MPESA_REVERSAL_TIMEOUT_URL',
        '',
      ),
      Remarks: 'OmniBite refund',
      Occasion: 'refund',
    };
    const res = await this.http.post('/mpesa/reversal/v1/request', body, {
      headers: await this.authHeaders(),
    });
    return res.data;
  }
}
