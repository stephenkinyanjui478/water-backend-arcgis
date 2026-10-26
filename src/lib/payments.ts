/**
 * Shared resolution logic for an in-flight STK push. The Daraja callback is the
 * primary signal (it updates the transaction row), but in environments where the
 * callback can't reach us we fall back to querying Daraja directly and reconcile
 * ourselves on a confirmed success. Both the status poll and the SSE stream build
 * on this so the two stay in lock-step.
 */
import { reconcilePayment } from "@/lib/billing";
import { stkQuery } from "@/lib/mpesa";
import { getTxn, markTxn, type TxnRow } from "@/lib/txn-store";

export function isTerminal(status: string | null): boolean {
  return (
    status === "Success" ||
    status === "Failed" ||
    status === "Cancelled" ||
    status === "ReconcileFailed"
  );
}

/**
 * Nudge a pending transaction forward by querying Daraja directly. On a confirmed
 * success the payment is reconciled (idempotently) and the row marked terminal.
 * Returns the freshest row; a no-op if the txn is already terminal, and never
 * throws (a query that's "still processing" just leaves the row pending).
 */
export async function advanceTxnViaQuery(txn: TxnRow): Promise<TxnRow> {
  if (isTerminal(txn.status) || !txn.checkout_request_id) return txn;
  try {
    const q = await stkQuery(txn.checkout_request_id);
    const rc = Number(q.ResultCode);
    if (rc === 0) {
      await reconcilePayment({
        meterNo: txn.meter_no || "",
        invoiceNos: (txn.invoice_nos || "").split(",").filter(Boolean),
        email: txn.email || "",
        mpesaReceipt: txn.mpesa_receipt || `MPESA-${txn.objectid}`,
      });
      await markTxn(txn.objectid, { status: "Success", result_code: 0, result_desc: q.ResultDesc || "Success" });
    } else if (rc === 1032) {
      await markTxn(txn.objectid, { status: "Cancelled", result_code: rc, result_desc: q.ResultDesc || "Cancelled" });
    } else if (!Number.isNaN(rc) && rc !== 1037 && String(q.ResultCode) !== "") {
      // 1037 = timeout/no response yet; leave pending. Other non-zero → failed.
      await markTxn(txn.objectid, { status: "Failed", result_code: rc, result_desc: q.ResultDesc || "Failed" });
    }
    return (await getTxn(txn.objectid)) || txn;
  } catch {
    // Query may legitimately be "still processing" — keep the current status.
    return txn;
  }
}
