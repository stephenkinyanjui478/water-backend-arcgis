import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth, HttpError } from "@/lib/http";
import { assertServerConfig } from "@/lib/config";
import { assertOwnsMeter } from "@/lib/customers";
import { getPayableInvoices } from "@/lib/billing";
import { createPendingTxn, setTxnRequestIds, markTxn } from "@/lib/txn-store";
import { stkPush, isValidMsisdn, normalizeMsisdn } from "@/lib/mpesa";

/**
 * Initiate an M-Pesa STK Push for a set of the customer's unpaid invoices on one
 * meter. Records a pending transaction, triggers the push, and returns the
 * CheckoutRequestID the client polls for completion.
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "POST");
  assertServerConfig();
  const claims = requireAuth(req);

  const body = (req.body || {}) as { meterNo?: string; invoiceNos?: string[]; phone?: string };
  const meterNo = (body.meterNo || "").trim();
  const invoiceNos = Array.isArray(body.invoiceNos) ? body.invoiceNos.map(String) : [];
  const phone = (body.phone || "").trim();

  if (!meterNo) throw new HttpError(400, "meterNo is required");
  if (!invoiceNos.length) throw new HttpError(400, "Select at least one invoice to pay");
  if (!isValidMsisdn(phone)) throw new HttpError(400, "Enter a valid Safaricom phone number");

  await assertOwnsMeter(claims.email, meterNo);

  const invoices = await getPayableInvoices(meterNo, invoiceNos);
  const owed = invoices.filter((i) => i.balance > 0);
  if (!owed.length) throw new HttpError(400, "The selected invoices have nothing outstanding");

  const amount = Math.round(owed.reduce((s, i) => s + i.balance, 0));
  if (amount < 1) throw new HttpError(400, "Amount must be at least KES 1");

  const paidInvoiceNos = owed.map((i) => i.invoiceNo);
  const txnId = await createPendingTxn({
    email: claims.email,
    meterNo,
    invoiceNos: paidInvoiceNos,
    phone: normalizeMsisdn(phone),
    amount,
  });

  try {
    const result = await stkPush({
      phone,
      amount,
      accountReference: meterNo,
      transactionDesc: "Water bill",
    });
    await setTxnRequestIds(txnId, result.MerchantRequestID, result.CheckoutRequestID);
    res.status(200).json({
      checkoutRequestId: result.CheckoutRequestID,
      merchantRequestId: result.MerchantRequestID,
      customerMessage: result.CustomerMessage,
      amount,
      invoiceNos: paidInvoiceNos,
    });
  } catch (err: any) {
    await markTxn(txnId, { status: "Failed", result_desc: err?.message?.slice(0, 250) || "STK push failed" });
    throw new HttpError(502, err?.message || "Failed to initiate M-Pesa payment");
  }
});
