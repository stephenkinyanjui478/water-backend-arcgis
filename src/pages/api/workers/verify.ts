import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth, HttpError } from "@/lib/http";
import { config } from "@/lib/config";
import { queryLayer, sqlEscape } from "@/lib/arcgis";

/**
 * Verify a field worker by the badge code printed on their ID card (FW-####).
 * Returns the worker's identity + capabilities so a customer can confirm the
 * person at their premises is genuine. Requires a signed-in customer to prevent
 * anonymous enumeration of the roster.
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET");
  requireAuth(req);

  const code = String(req.query.code || "").trim();
  if (!code) throw new HttpError(400, "A worker code is required");

  const rows = await queryLayer<any>(config.layers.fieldWorkers, {
    where: `UPPER(worker_code)='${sqlEscape(code.toUpperCase())}'`,
    outFields: "worker_code,worker_name,role,dma,active,is_meter_reader,is_technician,phone",
  });
  const w = rows[0];
  if (!w) {
    res.status(404).json({ verified: false, message: "No field worker matches this code." });
    return;
  }
  const capabilities: string[] = [];
  if (w.is_meter_reader === "Yes") capabilities.push("Meter Reader");
  if (w.is_technician === "Yes") capabilities.push("Technician");

  res.status(200).json({
    verified: w.active === "Yes",
    worker: {
      code: w.worker_code,
      name: w.worker_name,
      role: w.role,
      dma: w.dma,
      active: w.active === "Yes",
      capabilities,
    },
    message:
      w.active === "Yes"
        ? "This is a verified, active field worker."
        : "This code matches a worker who is NOT currently active. Do not grant access — call support.",
  });
});
