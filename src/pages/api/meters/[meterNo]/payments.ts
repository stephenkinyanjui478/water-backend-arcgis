import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth, HttpError } from "@/lib/http";
import { assertOwnsMeter } from "@/lib/customers";
import { config } from "@/lib/config";
import { queryLayer, sqlEscape } from "@/lib/arcgis";

/** Payment history for a meter (most recent first). */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET");
  const claims = requireAuth(req);
  const meterNo = String(req.query.meterNo || "");
  if (!meterNo) throw new HttpError(400, "meterNo is required");
  await assertOwnsMeter(claims.email, meterNo);

  const rows = await queryLayer<any>(config.layers.payments, {
    where: `meter_no='${sqlEscape(meterNo)}'`,
    outFields: "objectid,receipt_no,cust_name,meter_no,pay_type,method,amount,pay_date,billing_cycle,narration",
    orderByFields: "pay_date DESC",
  });

  const payments = rows.map((r) => ({
    objectId: r.objectid,
    receiptNo: r.receipt_no,
    payType: r.pay_type,
    method: r.method,
    amount: r.amount,
    payDate: r.pay_date,
    billingCycle: r.billing_cycle,
    narration: r.narration,
  }));
  res.status(200).json({ payments });
});
