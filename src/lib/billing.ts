/**
 * Billing read + reconciliation helpers over the public Water_Invoices /
 * Water_Payments / Water_Customers / ServiceConnections layers. All writes go
 * through the admin token for integrity.
 */
import { config } from "@/lib/config";
import { queryLayer, applyEdits, sqlEscape } from "@/lib/arcgis";

export interface PayableInvoice {
  objectId: number;
  invoiceNo: string;
  billingCycle: string;
  billed: number;
  totalPayable: number;
  paid: number;
  balance: number;
  status: string;
  custName: string | null;
  dma: string | null;
}

function invoiceInClause(invoiceNos: string[]): string {
  return invoiceNos.map((n) => `'${sqlEscape(n)}'`).join(",");
}

/** Fetch the selected invoices for a meter that are still owed (balance > 0). */
export async function getPayableInvoices(meterNo: string, invoiceNos: string[]): Promise<PayableInvoice[]> {
  if (!invoiceNos.length) return [];
  const rows = await queryLayer<any>(config.layers.invoices, {
    where: `meter_no='${sqlEscape(meterNo)}' AND invoice_no IN (${invoiceInClause(invoiceNos)})`,
    outFields: "objectid,invoice_no,billing_cycle,billed,total_payable,paid,balance,status,cust_name,dma",
  });
  return rows.map((r) => ({
    objectId: r.objectid,
    invoiceNo: r.invoice_no,
    billingCycle: r.billing_cycle,
    billed: Number(r.billed ?? 0),
    totalPayable: Number(r.total_payable ?? 0),
    paid: Number(r.paid ?? 0),
    balance: Number(r.balance ?? 0),
    status: r.status,
    custName: r.cust_name ?? null,
    dma: r.dma ?? null,
  }));
}

function receiptFor(base: string, idx: number): string {
  return idx === 0 ? base : `${base}-${idx + 1}`;
}

/**
 * Apply a successful M-Pesa payment to the given invoices: mark each invoice
 * fully settled, insert a Water_Payments row per invoice, and decrement the
 * customer balance + the meter's outstanding bill. Amounts are derived from each
 * invoice's own balance (the STK amount was their sum), so this is self-consistent
 * even if the exact total shifted slightly between initiation and callback.
 */
export async function reconcilePayment(input: {
  meterNo: string;
  invoiceNos: string[];
  email: string;
  mpesaReceipt: string;
}): Promise<{ applied: number; total: number }> {
  const invoices = await getPayableInvoices(input.meterNo, input.invoiceNos);
  const outstanding = invoices.filter((i) => i.balance > 0);
  if (!outstanding.length) return { applied: 0, total: 0 };

  const now = Date.now();
  const custName = outstanding[0].custName;

  // 1. Mark each invoice paid in full.
  await applyEdits(config.layers.invoices, {
    updates: outstanding.map((inv) => ({
      attributes: {
        objectid: inv.objectId,
        paid: inv.paid + inv.balance,
        balance: 0,
        status: "Paid",
        method: "M-Pesa",
      },
    })),
  });

  // 2. One payment record per invoice.
  await applyEdits(config.layers.payments, {
    adds: outstanding.map((inv, i) => ({
      attributes: {
        receipt_no: receiptFor(input.mpesaReceipt, i),
        cust_name: custName,
        meter_no: input.meterNo,
        pay_type: "Bill Payment",
        method: "M-Pesa",
        amount: inv.balance,
        pay_date: now,
        pay_ts: now,
        billing_cycle: inv.billingCycle,
        narration: `M-Pesa payment for invoice ${inv.invoiceNo}`,
      },
    })),
  });

  const total = outstanding.reduce((s, i) => s + i.balance, 0);

  // 3. Decrement the account balance (Water_Customers, keyed by email).
  const custRows = await queryLayer<any>(config.layers.customers, {
    where: `LOWER(email)='${sqlEscape(input.email.toLowerCase())}'`,
    outFields: "objectid,balance",
  });
  if (custRows[0]) {
    const newBal = Math.max(0, Number(custRows[0].balance ?? 0) - total);
    await applyEdits(config.layers.customers, {
      updates: [{ attributes: { objectid: custRows[0].objectid, balance: newBal } }],
    });
  }

  // 4. Decrement the meter's outstanding_bill (ServiceConnections).
  const connRows = await queryLayer<any>(config.layers.serviceConnections, {
    where: `meter_no='${sqlEscape(input.meterNo)}'`,
    outFields: "objectid,outstanding_bill",
  });
  if (connRows[0]) {
    const newOut = Math.max(0, Number(connRows[0].outstanding_bill ?? 0) - total);
    await applyEdits(config.layers.serviceConnections, {
      updates: [{ attributes: { objectid: connRows[0].objectid, outstanding_bill: newOut } }],
    });
  }

  return { applied: outstanding.length, total };
}
