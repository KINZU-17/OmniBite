import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface PesapalSubmitParams {
  amount: number;
  currency: string;
  reference: string; // our merchant reference (the payment id)
  description: string;
  callbackUrl: string; // where the diner lands after paying
  notificationId: string; // registered IPN id
  email?: string;
  phone?: string;
}

export interface PesapalSubmitResult {
  orderTrackingId: string;
  merchantReference: string;
  redirectUrl: string;
}

export interface PesapalStatusResult {
  statusCode: number; // 0 INVALID, 1 COMPLETED, 2 FAILED, 3 REVERSED
  description: string; // payment_status_description
  confirmationCode?: string;
}

/**
 * Pesapal API v3 client. The auth token is short-lived (~5 min); it is cached
 * and refreshed on expiry rather than fetched per request.
 *
 * CAVEAT: exact field names and status codes are the shape, not gospel — confirm
 * against the live Pesapal API v3 docs (or your integrator) before go-live. They
 * are all confined to this file so reconciliation is a single edit.
 */
@Injectable()
export class PesapalClient {
  private readonly logger = new Logger(PesapalClient.name);
  private readonly http: AxiosInstance;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {
    this.http = axios.create({
      baseURL: this.config.get<string>(
        'PESAPAL_BASE_URL',
        'https://cybqa.pesapal.com/pesapalv3',
      ),
      timeout: 30_000,
    });
  }

  get configured(): boolean {
    return (
      !!this.config.get<string>('PESAPAL_BASE_URL', '') &&
      !!this.config.get<string>('PESAPAL_CONSUMER_KEY', '')
    );
  }

  async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) {
      return this.token.value;
    }
    const res = await this.http.post<{ token?: string; expiryDate?: string }>(
      '/api/Auth/RequestToken',
      {
        consumer_key: this.config.get<string>('PESAPAL_CONSUMER_KEY', ''),
        consumer_secret: this.config.get<string>('PESAPAL_CONSUMER_SECRET', ''),
      },
      { headers: { Accept: 'application/json' } },
    );
    const value = res.data.token ?? '';
    const expiresAt = res.data.expiryDate
      ? Date.parse(res.data.expiryDate)
      : Date.now() + 5 * 60_000;
    this.token = { value, expiresAt };
    return value;
  }

  private async authHeaders() {
    return {
      Authorization: `Bearer ${await this.getToken()}`,
      Accept: 'application/json',
    };
  }

  /** Create a hosted-checkout order; returns the redirect URL + tracking id. */
  async submitOrder(p: PesapalSubmitParams): Promise<PesapalSubmitResult> {
    const body = {
      id: p.reference,
      currency: p.currency,
      amount: p.amount,
      description: p.description,
      callback_url: p.callbackUrl,
      notification_id: p.notificationId,
      billing_address: {
        email_address: p.email ?? undefined,
        phone_number: p.phone ?? undefined,
      },
    };
    const res = await this.http.post<{
      order_tracking_id?: string;
      merchant_reference?: string;
      redirect_url?: string;
    }>('/api/Transactions/SubmitOrderRequest', body, {
      headers: await this.authHeaders(),
    });
    return {
      orderTrackingId: String(res.data.order_tracking_id ?? ''),
      merchantReference: String(res.data.merchant_reference ?? p.reference),
      redirectUrl: String(res.data.redirect_url ?? ''),
    };
  }

  /** Status query — the backstop for a dropped IPN. */
  async getStatus(orderTrackingId: string): Promise<PesapalStatusResult> {
    const res = await this.http.get<{
      status_code?: string | number;
      payment_status_description?: string;
      confirmation_code?: string;
    }>('/api/Transactions/GetTransactionStatus', {
      params: { orderTrackingId },
      headers: await this.authHeaders(),
    });
    return {
      statusCode: Number(res.data.status_code ?? 0),
      description: String(res.data.payment_status_description ?? ''),
      confirmationCode: res.data.confirmation_code
        ? String(res.data.confirmation_code)
        : undefined,
    };
  }
}
