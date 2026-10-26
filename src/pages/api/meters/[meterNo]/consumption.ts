import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth, HttpError } from "@/lib/http";
import { assertOwnsMeter } from "@/lib/customers";
import { config } from "@/lib/config";
import { queryLayer, sqlEscape } from "@/lib/arcgis";

/** Consumption trend for a meter — one point per billing cycle (oldest first). */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET");
  const claims = requireAuth(req);
  const meterNo = String(req.query.meterNo || "");
  if (!meterNo) throw new HttpError(400, "meterNo is required");
  await assertOwnsMeter(claims.email, meterNo);

  const rows = await queryLayer<any>(config.layers.meterReadings, {
    where: `meter_no='${sqlEscape(meterNo)}' AND consumption IS NOT NULL`,
    outFields: "billing_cycle,consumption,current_reading,prev_reading,reading_date,reading_status",
    orderByFields: "reading_date ASC",
  });

  const points = rows.map((r) => ({
    billingCycle: r.billing_cycle,
    consumption: Number(r.consumption ?? 0),
    currentReading: r.current_reading,
    prevReading: r.prev_reading,
    readingDate: r.reading_date,
    readingStatus: r.reading_status,
  }));

  const values = points.map((p) => p.consumption);
  const total = values.reduce((a, b) => a + b, 0);
  const summary = {
    count: points.length,
    total,
    average: points.length ? total / points.length : 0,
    latest: values.length ? values[values.length - 1] : 0,
    peak: values.length ? Math.max(...values) : 0,
  };
  res.status(200).json({ points, summary });
});
