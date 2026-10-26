/**
 * Safaricom Daraja (M-Pesa) client — OAuth, Lipa na M-Pesa Online STK Push, and
 * the STK Push status query. Production by default; set MPESA_ENV=sandbox to point
 * at the sandbox host. All credentials come from env (see assertMpesaConfig).
 */
import { config, assertMpesaConfig } from "@/lib/config";

const HOSTS = {
  production: "https://api.safaricom.co.ke",
  sandbox: "https://sandbox.safaricom.co.ke",
};

function baseUrl(): string {
  return config.mpesa.env === "sandbox" ? HOSTS.sandbox : HOSTS.production;
}

/** Daraja timestamp: YYYYMMDDHHmmss in EAT (server local may differ — build from parts). */
export function darajaTimestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

/** Lipa na M-Pesa password = base64(shortcode + passkey + timestamp). */
function stkPassword(timestamp: string): string {
  const raw = `${config.mpesa.shortcode}${config.mpesa.passkey}${timestamp}`;
  return Buffer.from(raw).toString("base64");
}

/** Normalise a Kenyan phone number to the 2547XXXXXXXX / 2541XXXXXXXX form. */
export function normalizeMsisdn(phone: string): string {
  let p = (phone || "").replace(/[^\d]/g, "");
  if (p.startsWith("0")) p = "254" + p.slice(1);
  else if (p.startsWith("7") || p.startsWith("1")) p = "254" + p;
  else if (p.startsWith("254")) {
    /* already normalised */
  } else if (p.startsWith("2540")) p = "254" + p.slice(4);
  return p;
}

export function isValidMsisdn(phone: string): boolean {
  return /^254(7|1)\d{8}$/.test(normalizeMsisdn(phone));
}

let tokenCache: { token: string; expires: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expires - 60_000 > now) return tokenCache.token;

  const auth = Buffer.from(`${config.mpesa.consumerKey}:${config.mpesa.consumerSecret}`).toString("base64");
  const res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`Daraja OAuth failed (HTTP ${res.status}): ${JSON.stringify(json)}`);
  }
  tokenCache = { token: json.access_token, expires: now + Number(json.expires_in || 3599) * 1000 };
  return tokenCache.token;
}

export interface StkPushParams {
  /** Payer phone (any local format). */
  phone: string;
  /** Integer KES amount (Daraja rejects decimals). */
  amount: number;
  /** Shown on the customer's phone + echoed back; e.g. the meter number. */
  accountReference: string;
  transactionDesc: string;
}

export interface StkPushResult {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
}

/** Initiate an STK push. Throws if Daraja rejects the request synchronously. */
export async function stkPush(params: StkPushParams): Promise<StkPushResult> {
  assertMpesaConfig();
  const token = await getAccessToken();
  const timestamp = darajaTimestamp();
  const body = {
    BusinessShortCode: config.mpesa.shortcode,
    Password: stkPassword(timestamp),
    Timestamp: timestamp,
    TransactionType: config.mpesa.transactionType,
    Amount: Math.round(params.amount),
    PartyA: normalizeMsisdn(params.phone),
    PartyB: config.mpesa.shortcode,
    PhoneNumber: normalizeMsisdn(params.phone),
    CallBackURL: config.mpesa.callbackUrl,
    AccountReference: params.accountReference.slice(0, 12),
    TransactionDesc: params.transactionDesc.slice(0, 13),
  };
  const res = await fetch(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.ResponseCode !== "0") {
    throw new Error(json.errorMessage || json.ResponseDescription || `STK push failed (HTTP ${res.status})`);
  }
  return json as StkPushResult;
}

export interface StkQueryResult {
  ResponseCode: string;
  ResultCode: string;
  ResultDesc: string;
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
}

/** Query the status of a prior STK push (used for polling fallback to the callback). */
export async function stkQuery(checkoutRequestId: string): Promise<StkQueryResult> {
  assertMpesaConfig();
  const token = await getAccessToken();
  const timestamp = darajaTimestamp();
  const res = await fetch(`${baseUrl()}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: config.mpesa.shortcode,
      Password: stkPassword(timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  // Daraja returns a 500-ish body with errorCode 500.001.1001 while the user hasn't
  // acted yet ("transaction is being processed") — treat that as still-pending.
  if (json.errorCode === "500.001.1001") {
    return { ResponseCode: "0", ResultCode: "1032", ResultDesc: "Request is being processed" };
  }
  if (!res.ok && !json.ResultCode) {
    throw new Error(json.errorMessage || `STK query failed (HTTP ${res.status})`);
  }
  return json as StkQueryResult;
}
