import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth, HttpError } from "@/lib/http";
import { findTxnByCheckoutId } from "@/lib/txn-store";
import { advanceTxnViaQuery, isTerminal } from "@/lib/payments";

/**
 * Poll the state of an STK push. Primarily reads our transaction record (updated
 * by the callback). As a fallback — important for environments where the Daraja
 * callback can't reach us — it also queries Daraja directly and, on a confirmed
 * success that the callback hasn't yet reconciled, applies the payment itself
 * (idempotently; a synthetic receipt is used since the query API omits it).
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET");
  const claims = requireAuth(req);

  const checkoutRequestId = String(req.query.checkoutRequestId || "").trim();
  if (!checkoutRequestId) throw new HttpError(400, "checkoutRequestId is required");

  let txn = await findTxnByCheckoutId(checkoutRequestId);
  if (!txn) throw new HttpError(404, "Transaction not found");
  if ((txn.email || "").toLowerCase() !== claims.email.toLowerCase()) {
    throw new HttpError(403, "Not your transaction");
  }

  if (!isTerminal(txn.status) && (req.query.query === "1" || req.query.query === "true")) {
    txn = await advanceTxnViaQuery(txn);
  }

  res.status(200).json({
    status: txn.status,
    resultDesc: txn.result_desc,
    mpesaReceipt: txn.mpesa_receipt,
    amount: txn.amount,
    meterNo: txn.meter_no,
    invoiceNos: (txn.invoice_nos || "").split(",").filter(Boolean),
  });
});
