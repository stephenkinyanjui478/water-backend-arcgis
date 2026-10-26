/**
 * Access to the PRIVATE Water_MpesaTransactions audit table. Every STK push is
 * recorded here before it is sent and updated when Daraja calls back, giving a
 * reconcilable trail and an idempotency anchor (checkout_request_id).
 */
import { config } from "@/lib/config";
import { queryLayer, insertOne, applyEdits, sqlEscape } from "@/lib/arcgis";

export interface TxnRow {
  objectid: number;
  merchant_request_id: string | null;
  checkout_request_id: string | null;
  email: string | null;
  meter_no: string | null;
  invoice_nos: string | null;
  phone: string | null;
  amount: number | null;
  account_ref: string | null;
  status: string | null;
  result_code: number | null;
  result_desc: string | null;
  mpesa_receipt: string | null;
}

const OUT_FIELDS =
  "objectid,merchant_request_id,checkout_request_id,email,meter_no,invoice_nos,phone,amount,account_ref,status,result_code,result_desc,mpesa_receipt";

export async function createPendingTxn(input: {
  email: string;
  meterNo: string;
  invoiceNos: string[];
  phone: string;
  amount: number;
}): Promise<number> {
  return insertOne(config.layers.mpesaTxn, {
    email: input.email.toLowerCase(),
    meter_no: input.meterNo,
    invoice_nos: input.invoiceNos.join(","),
    phone: input.phone,
    amount: input.amount,
    account_ref: input.meterNo,
    status: "Pending",
    created_ts: Date.now(),
    updated_ts: Date.now(),
  });
}

export async function setTxnRequestIds(
  objectid: number,
  merchantRequestId: string,
  checkoutRequestId: string
): Promise<void> {
  await applyEdits(config.layers.mpesaTxn, {
    updates: [
      {
        attributes: {
          objectid,
          merchant_request_id: merchantRequestId,
          checkout_request_id: checkoutRequestId,
          updated_ts: Date.now(),
        },
      },
    ],
  });
}

export async function markTxn(
  objectid: number,
  patch: Partial<Pick<TxnRow, "status" | "result_code" | "result_desc" | "mpesa_receipt">>
): Promise<void> {
  await applyEdits(config.layers.mpesaTxn, {
    updates: [{ attributes: { objectid, ...patch, updated_ts: Date.now() } }],
  });
}

export async function findTxnByCheckoutId(checkoutRequestId: string): Promise<TxnRow | null> {
  const rows = await queryLayer<TxnRow>(config.layers.mpesaTxn, {
    where: `checkout_request_id='${sqlEscape(checkoutRequestId)}'`,
    outFields: OUT_FIELDS,
  });
  return rows[0] || null;
}

export async function getTxn(objectid: number): Promise<TxnRow | null> {
  const rows = await queryLayer<TxnRow>(config.layers.mpesaTxn, {
    where: `objectid=${objectid}`,
    outFields: OUT_FIELDS,
  });
  return rows[0] || null;
}
