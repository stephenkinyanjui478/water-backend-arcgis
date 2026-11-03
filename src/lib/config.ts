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
    serviceConnections: `${HOSTED}/WSP_UtilityNetwork_UTM/FeatureServer/1`,
    // Additional hosted layers/tables the operations console reads + edits.
    billingCycles: `${HOSTED}/Water_Billing_Cycles/FeatureServer/0`,
    tariffs: `${HOSTED}/Water_Tariffs/FeatureServer/0`,
    workOrderTypes: `${HOSTED}/Water_WorkOrderTypes/FeatureServer/0`,
    orgSettings: `${HOSTED}/Water_OrgSettings/FeatureServer/0`,
    orgMembers: `${HOSTED}/Water_OrgMembers/FeatureServer/0`,
    maintenanceWorkOrders: `${HOSTED}/Water_MaintenanceWorkOrders/FeatureServer/0`,
    meterReadWorkOrders: `${HOSTED}/Water_MeterReadWorkOrders/FeatureServer/0`,
    // Zones — layer 13 of the reprojected utility-network service (UTM 37S /
    // EPSG:32737), so SHAPE__Area is metric (m² → km²). Single source of truth
    // with the Utility Network map now that the whole service is projected.
    zones: `${HOSTED}/WSP_UtilityNetwork_UTM/FeatureServer/13`,
    zoneSupply: `${HOSTED}/Water_ZoneSupply/FeatureServer/0`,
    // PRIVATE tables — owner-only, backend admin-token access exclusively.
    customerAuth: process.env.CUSTOMER_AUTH_URL || `${HOSTED}/Water_CustomerAuth/FeatureServer/0`,
    mpesaTxn: process.env.MPESA_TXN_URL || `${HOSTED}/Water_MpesaTransactions/FeatureServer/0`,
    // PRIVATE single-row table holding ALL organization details — profile, support
    // contacts, M-Pesa / SMS / Email settings (incl. SECRETS) and notification
    // settings — managed from the operations console Organization page. Owner-only;
    // the backend reads/writes it with the admin token and masks secrets. This
    // consolidates the retired Water_OrgSettings (+ _Secure) pair into one table.
    organization: process.env.ORGANIZATION_URL || `${HOSTED}/Water_Organization/FeatureServer/0`,
  },

  /** Public URL of the customer self-service portal (customers-app). Used in the
   *  welcome email's sign-in link; falls back to the first allowed origin. */
  customerPortalUrl: (
    process.env.CUSTOMER_PORTAL_URL ||
    (process.env.ALLOWED_ORIGIN || "http://localhost:3000").split(",")[0]
  )
    .trim()
    .replace(/\/+$/, ""),

  /** Admin console (the static WSP client) sign-in. */
  admin: {
    password: process.env.ADMIN_PASSWORD || "",
  },

  /**
   * Operations console — the OAuth-gated React front-end (operations-console/).
   * Uses the registered ArcGIS portal app (authorization-code flow) to sign the
   * operator in against the esriea portal; the backend exchanges the code with the
   * client secret and issues an httpOnly ops session. The redirect URI must be
   * registered on the OAuth app.
   */
  ops: {
    clientId: process.env.OPS_OAUTH_CLIENT_ID || process.env.ARCGIS_CLIENT_ID || "",
    clientSecret: process.env.OPS_OAUTH_CLIENT_SECRET || process.env.ARCGIS_CLIENT_SECRET || "",
    redirectUri: process.env.OPS_OAUTH_REDIRECT_URI || "http://localhost:4000/api/ops/oauth/callback",
    consoleUrl: (process.env.OPS_CONSOLE_URL || "http://localhost:3100").replace(/\/+$/, ""),
    // No entry gate: any authenticated portal member may sign in.
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

  // SMS (Africastalking) + Email (SMTP) env DEFAULTS. These are overridden at
  // runtime by whatever is saved in the private Water_OrgSettings_Secure table
  // (see settings-store.ts) — the env values are just the fallback.
  sms: {
    username: process.env.SMS_USERNAME || "",
    apiKey: process.env.SMS_API_KEY || "",
    senderId: process.env.SMS_SENDER_ID || "",
  },

  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 0) || null,
    secure: /^(1|true|yes)$/i.test(process.env.SMTP_SECURE || ""),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "",
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
