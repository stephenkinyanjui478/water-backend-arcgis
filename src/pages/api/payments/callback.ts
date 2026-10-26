import type { NextApiRequest, NextApiResponse } from "next";
import { withApi } from "@/lib/http";
import { findTxnByCheckoutId, markTxn } from "@/lib/txn-store";
import { reconcilePayment } from "@/lib/billing";

/**
 * Daraja STK Push callback (webhook). Daraja cannot carry our JWT, so this route
 * is unauthenticated by necessity — it is secured by (a) matching the
 * CheckoutRequestID against a transaction WE created, and (b) idempotency so
 * Daraja's retries don't double-apply. It must always answer 200 so Daraja stops
 * retrying. Point MPESA_CALLBACK_URL at a public HTTPS URL for this path.
 */
function metaValue(items: any[], name: string): any {
  return (items || []).find((i) => i?.Name === name)?.Value;
}

export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  // Acknowledge regardless of what we do internally.
  const ack = () => res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

  if (req.method !== "POST") return ack();

  const stk = req.body?.Body?.stkCallback;
  if (!stk?.CheckoutRequestID) return ack();

  const txn = await findTxnByCheckoutId(stk.CheckoutRequestID);
  if (!txn) return ack(); // unknown / spoofed — ignore but acknowledge.
  if (txn.status === "Success") return ack(); // already reconciled (retry).

  const resultCode = Number(stk.ResultCode);
  if (resultCode !== 0) {
    const status = resultCode === 1032 ? "Cancelled" : "Failed";
    await markTxn(txn.objectid, {
      status,
      result_code: resultCode,
      result_desc: String(stk.ResultDesc || "").slice(0, 250),
    });
    return ack();
  }

  const items = stk.CallbackMetadata?.Item || [];
  const mpesaReceipt = String(metaValue(items, "MpesaReceiptNumber") || "");

  try {
    await reconcilePayment({
      meterNo: txn.meter_no || "",
      invoiceNos: (txn.invoice_nos || "").split(",").filter(Boolean),
      email: txn.email || "",
      mpesaReceipt: mpesaReceipt || `MPESA-${txn.objectid}`,
    });
    await markTxn(txn.objectid, {
      status: "Success",
      result_code: 0,
      result_desc: String(stk.ResultDesc || "Success").slice(0, 250),
      mpesa_receipt: mpesaReceipt,
    });
  } catch (err: any) {
    // Payment succeeded at Daraja but reconciliation failed — flag for manual review.
    await markTxn(txn.objectid, {
      status: "ReconcileFailed",
      result_code: 0,
      result_desc: `Paid; reconcile error: ${String(err?.message || "").slice(0, 200)}`,
      mpesa_receipt: mpesaReceipt,
    });
    console.error("[mpesa callback] reconcile failed:", err);
  }
  return ack();
});

// Daraja sends JSON; keep the default body parser.
export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };
