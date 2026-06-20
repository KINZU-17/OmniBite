# OmniBite — M-Pesa (Daraja) Integration Sequence

How OmniBite collects payment for a round and resolves every outcome. This maps onto the `payments` and `mpesa_transactions` tables and the Payment lifecycle in the state machine.

One engineering note up front: treat the exact field names and result codes below as the shape, and confirm each against Safaricom's current Daraja documentation before coding. The flow is stable; specific codes drift.

---

## Endpoints

- **Sandbox**: `https://sandbox.safaricom.co.ke`
- **Production**: `https://api.safaricom.co.ke`

You build and test against sandbox, then apply for go-live to get a production shortcode and passkey.

---

## Step 1 — OAuth token

`GET /oauth/v1/generate?grant_type=client_credentials` with HTTP Basic auth (base64 of `consumer_key:consumer_secret`).

Returns an `access_token` valid for roughly one hour. **Cache it** and refresh on expiry rather than fetching one per request. Every later call carries `Authorization: Bearer {access_token}`.

---

## Step 2 — STK push (request payment)

Fired when a round reaches AWAITING_PAYMENT. One push per payer in split mode.

`POST /mpesa/stkpush/v1/processrequest`

```json
{
  "BusinessShortCode": "<shortcode>",
  "Password": "base64(Shortcode + Passkey + Timestamp)",
  "Timestamp": "YYYYMMDDHHmmss",
  "TransactionType": "CustomerBuyGoodsOnline",   // till; use CustomerPayBillOnline for paybill
  "Amount": 850,
  "PartyA": "2547XXXXXXXX",                       // payer phone
  "PartyB": "<shortcode>",
  "PhoneNumber": "2547XXXXXXXX",
  "CallBackURL": "https://api.omnibite.co.ke/mpesa/callback",
  "AccountReference": "<table_or_round_ref>",     // links payment to the table; keep short
  "TransactionDesc": "OmniBite order"
}
```

Synchronous response carries `MerchantRequestID`, `CheckoutRequestID`, and a `ResponseCode` (`0` means the push was accepted, not that it was paid). On acceptance:
- Create the `payments` row in INITIATED, then PENDING.
- Create the `mpesa_transactions` row storing `checkout_request_id` and `merchant_request_id`.

The customer now sees the PIN prompt on their phone. Nothing fires yet.

---

## Step 3 — Callback (the real result)

Safaricom POSTs to your `CallBackURL`. This is the source of truth.

Success body contains `ResultCode: 0` plus metadata: `Amount`, `MpesaReceiptNumber`, `TransactionDate`, `PhoneNumber`. On failure, `ResultCode` is non-zero and there is no metadata.

Handler logic:
1. Look up the `mpesa_transactions` row by `CheckoutRequestID`.
2. **Idempotency**: if `mpesa_receipt` is already set, acknowledge and stop. A duplicate callback must never double-record.
3. On `ResultCode 0`: store `MpesaReceiptNumber` into `mpesa_receipt`, set the payment CONFIRMED. The unique index on `mpesa_receipt` is the hard guard.
4. On non-zero: set the payment FAILED, store `ResultCode` and `ResultDesc`, offer retry.
5. Always return a 200 acknowledgement to Safaricom quickly. Do the heavy work, then acknowledge.

When the last required payment in a round goes CONFIRMED, the round transitions to PAID, which fires the kitchen ticket and queues the eTIMS invoice.

Result codes you will see often (confirm against current docs, treat any non-zero as failure):

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Insufficient balance |
| 1032 | Cancelled by user |
| 1037 | Timeout, user unreachable or no PIN entered |
| 2001 | Wrong PIN |

---

## Step 4 — Status-query backstop (no callback arrived)

Callbacks get dropped. A reaper job scans `payments` where `status IN ('PENDING','UNKNOWN')` older than the timeout T and calls:

`POST /mpesa/stkpushquery/v1/query` with `BusinessShortCode`, `Password`, `Timestamp`, `CheckoutRequestID`.

The response `ResultCode` resolves the payment to CONFIRMED or FAILED. Increment `status_query_count` each attempt. This is what guarantees the invariant that no payment rests in PENDING forever. A diner is never left staring at a spinner because a callback went missing.

---

## Step 5 — Refunds (reversal)

The Refund lifecycle's RESOLVED_REVERSAL path uses `POST /mpesa/reversal/v1/request`, which needs the original `MpesaReceiptNumber`, an initiator name, and an encrypted security credential. It is operationally heavy and not instant.

For that reason store credit is the default remedy in OmniBite, and a true reversal is the exception. Whichever path, the refund still writes an eTIMS credit note and an audit log entry.

---

## Step 6 — Optional: catch manual till payments

If a diner pays the till directly instead of through the STK prompt, register C2B confirmation and validation URLs so OmniBite still captures the payment and matches it to the table. Optional for phase one, useful where staff sometimes key payments manually.

---

## Go-live checklist
- Production app approved, production shortcode and passkey issued.
- Callback URL publicly reachable over HTTPS and fast to acknowledge.
- Token caching in place.
- Idempotency proven with replayed callbacks in test.
- Reaper job proven against a deliberately dropped callback.
- Reversal initiator credentials provisioned, even if store credit is the default.
