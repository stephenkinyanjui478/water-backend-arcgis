import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth, HttpError } from "@/lib/http";
import { assertOwnsMeter } from "@/lib/customers";
import { config } from "@/lib/config";
import { queryLayer, sqlEscape } from "@/lib/arcgis";

/** Invoices for a meter. ?status=Unpaid,Partial narrows to those still owed. */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET");
  const claims = requireAuth(req);
  const meterNo = String(req.query.meterNo || "");
  if (!meterNo) throw new HttpError(400, "meterNo is required");
  await assertOwnsMeter(claims.email, meterNo);

  let where = `meter_no='${sqlEscape(meterNo)}'`;
  const statusParam = typeof req.query.status === "string" ? req.query.status : "";
  if (statusParam) {
    const statuses = statusParam
      .split(",")
      .map((s) => `'${sqlEscape(s.trim())}'`)
      .join(",");
    where += ` AND status IN (${statuses})`;
  }

  const rows = await queryLayer<any>(config.layers.invoices, {
    where,
    outFields:
      "objectid,invoice_no,meter_no,cust_name,billing_cycle,consumption,prev_balance,billed,total_payable,paid,balance,status,method,inv_date,dma",
    orderByFields: "inv_date DESC",
  });

  const invoices = rows.map((r) => ({
    objectId: r.objectid,
    invoiceNo: r.invoice_no,
    billingCycle: r.billing_cycle,
    consumption: r.consumption,
    prevBalance: r.prev_balance,
    billed: r.billed,
    totalPayable: r.total_payable,
    paid: r.paid,
    balance: r.balance,
    status: r.status,
    method: r.method,
    invDate: r.inv_date,
    dma: r.dma,
  }));
  res.status(200).json({ invoices });
});
