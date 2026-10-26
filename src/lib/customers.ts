/**
 * Customer + meter domain logic.
 *
 * A customer is identified by email (their login). "Accounts" are meters: a
 * customer can own several. Because Water_Customers has no meter_no, ownership is
 * derived by joining across the existing public layers:
 *
 *   • Water_MeterReadings carries email ↔ meter_no directly.
 *   • Water_Customers (email ↔ cust_name) → ServiceConnections (customer ↔ meter_no).
 *
 * The union of those two paths is the customer's meter set. ServiceConnections is
 * the authoritative source of per-meter detail (tariff, DMA, status, outstanding).
 */
import { config } from "@/lib/config";
import { queryLayer, sqlEscape } from "@/lib/arcgis";
import { HttpError } from "@/lib/http";

export interface Meter {
  meterNo: string;
  customerName: string | null;
  dma: string | null;
  tariff: string | null;
  connType: string | null;
  connStatus: string | null;
  outstandingBill: number;
  latestReading: number | null;
  prevReading: number | null;
  connectionDate: number | null;
  accountNo: string | null;
  accountBalance: number | null;
}

function inClause(values: string[]): string {
  return values.map((v) => `'${sqlEscape(v)}'`).join(",");
}

/** Distinct meter numbers a customer owns, via both join paths. */
export async function getOwnedMeterNos(email: string): Promise<string[]> {
  const e = sqlEscape(email.toLowerCase());
  const meters = new Set<string>();

  // Path 1 — readings directly reference the email.
  const readings = await queryLayer<{ meter_no: string }>(config.layers.meterReadings, {
    where: `LOWER(email)='${e}'`,
    outFields: "meter_no",
  });
  for (const r of readings) if (r.meter_no) meters.add(r.meter_no);

  // Path 2 — customer records → their names → service connections.
  const customers = await queryLayer<{ cust_name: string }>(config.layers.customers, {
    where: `LOWER(email)='${e}'`,
    outFields: "cust_name",
  });
  const names = [...new Set(customers.map((c) => c.cust_name).filter(Boolean))];
  if (names.length) {
    const conns = await queryLayer<{ meter_no: string }>(config.layers.serviceConnections, {
      where: `customer IN (${inClause(names)})`,
      outFields: "meter_no",
    });
    for (const c of conns) if (c.meter_no) meters.add(c.meter_no);
  }

  return [...meters];
}

/** Full meter records (with billing context) for a customer. */
export async function getCustomerMeters(email: string): Promise<Meter[]> {
  const meterNos = await getOwnedMeterNos(email);
  if (!meterNos.length) return [];

  const connsByMeter = new Map<string, any>();
  const conns = await queryLayer<any>(config.layers.serviceConnections, {
    where: `meter_no IN (${inClause(meterNos)})`,
    outFields:
      "meter_no,customer,dma,tariff,conn_type,conn_status,outstanding_bill,latest_reading,prev_reading,connection_date",
  });
  for (const c of conns) connsByMeter.set(c.meter_no, c);

  // Account-level record (account_no, balance) keyed by this email.
  const custRows = await queryLayer<any>(config.layers.customers, {
    where: `LOWER(email)='${sqlEscape(email.toLowerCase())}'`,
    outFields: "account_no,cust_name,balance",
  });
  const account = custRows[0] || null;

  return meterNos.map((meterNo) => {
    const c = connsByMeter.get(meterNo) || {};
    return {
      meterNo,
      customerName: c.customer ?? account?.cust_name ?? null,
      dma: c.dma ?? null,
      tariff: c.tariff ?? null,
      connType: c.conn_type ?? null,
      connStatus: c.conn_status ?? null,
      outstandingBill: Number(c.outstanding_bill ?? 0),
      latestReading: c.latest_reading ?? null,
      prevReading: c.prev_reading ?? null,
      connectionDate: c.connection_date ?? null,
      accountNo: account?.account_no ?? null,
      accountBalance: account?.balance ?? null,
    };
  });
}

/** Throw 403 unless the email owns the meter. Guards per-meter data routes. */
export async function assertOwnsMeter(email: string, meterNo: string): Promise<void> {
  const owned = await getOwnedMeterNos(email);
  if (!owned.includes(meterNo)) {
    throw new HttpError(403, "You do not have access to this meter");
  }
}
