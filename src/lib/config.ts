/**
 * Central configuration for the customer-portal backend.
 *
 * Secrets (ArcGIS admin password, JWT secret, M-Pesa Daraja keys) are read from
 * environment variables only — never hard-coded. See .env.example. This module is
 * server-side only; it must never be imported from client code.
 */

const PORTAL = (process.env.ARCGIS_PORTAL || "https://development.esriea.com/portal").replace(/\/+$/, "");
const SERVER = PORTAL.replace("/portal", "/server");
const HOSTED = `${SERVER}/rest/services/Hosted`;

export const config = {
  portal: PORTAL,
  arcgis: {
    user: process.env.ARCGIS_USER || "skinyanjui_esriea",
    password: process.env.ARCGIS_PASSWORD || process.env.ESRIEA_PORTAL_PASSWORD || "",
    referer: process.env.ARCGIS_REFERER || new URL(PORTAL).origin,
  },

  /** Hosted feature-layer / table endpoints the portal is built on. */
  layers: {
    customers: `${HOSTED}/Water_Customers/FeatureServer/0`,
    invoices: `${HOSTED}/Water_Invoices/FeatureServer/0`,
    payments: `${HOSTED}/Water_Payments/FeatureServer/0`,
    meterReadings: `${HOSTED}/Water_MeterReadings/FeatureServer/0`,
    incidences: `${HOSTED}/Water_Incidences/FeatureServer/0`,
    incidenceTypes: `${HOSTED}/Water_IncidenceTypes/FeatureServer/0`,
    fieldWorkers: `${HOSTED}/Water_FieldWorkers/FeatureServer/0`,
    serviceConnections: `${HOSTED}/WSP_UtilityNetwork/FeatureServer/1`,
    // PRIVATE tables — owner-only, backend admin-token access exclusively.
    customerAuth: process.env.CUSTOMER_AUTH_URL || `${HOSTED}/Water_CustomerAuth/FeatureServer/0`,
    mpesaTxn: process.env.MPESA_TXN_URL || `${HOSTED}/Water_MpesaTransactions/FeatureServer/0`,
  },

  jwt: {
    secret: process.env.JWT_SECRET || "",
    expiresIn: process.env.JWT_EXPIRES || "7d",
    issuer: "wsp-customer-portal",
  },

  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),

  /** Comma-separated list of browser origins allowed to call this API. */
  allowedOrigins: (process.env.ALLOWED_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  mpesa: {
    env: (process.env.MPESA_ENV || "production").toLowerCase(), // "production" | "sandbox"
    consumerKey: process.env.MPESA_CONSUMER_KEY || "",
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || "",
    shortcode: process.env.MPESA_SHORTCODE || "",
    passkey: process.env.MPESA_PASSKEY || "",
    callbackUrl: process.env.MPESA_CALLBACK_URL || "",
    // CustomerPayBillOnline (paybill) or CustomerBuyGoodsOnline (till).
    transactionType: process.env.MPESA_TRANSACTION_TYPE || "CustomerPayBillOnline",
  },
};

export function assertServerConfig() {
  const missing: string[] = [];
  if (!config.arcgis.password) missing.push("ARCGIS_PASSWORD (or ESRIEA_PORTAL_PASSWORD)");
  if (!config.jwt.secret) missing.push("JWT_SECRET");
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }
}

export function assertMpesaConfig() {
  const m = config.mpesa;
  const missing: string[] = [];
  if (!m.consumerKey) missing.push("MPESA_CONSUMER_KEY");
  if (!m.consumerSecret) missing.push("MPESA_CONSUMER_SECRET");
  if (!m.shortcode) missing.push("MPESA_SHORTCODE");
  if (!m.passkey) missing.push("MPESA_PASSKEY");
  if (!m.callbackUrl) missing.push("MPESA_CALLBACK_URL");
  if (missing.length) {
    throw new Error(`Missing M-Pesa env: ${missing.join(", ")}`);
  }
}
