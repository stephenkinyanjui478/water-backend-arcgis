import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireOps, HttpError } from "@/lib/http";
import { inngest } from "@/lib/inngest";

/**
 * Queue a templated SMS to the selected customers (by Water_Customers OBJECTID).
 * The template is rendered per-recipient by the notifyCustomers Inngest function,
 * which sends and logs each message in the background. Returns as soon as the
 * event is accepted.
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireOps(req);
  if (req.method !== "POST") throw new HttpError(405, `Method ${req.method} not allowed`);

  const oids = ((req.body?.oids as unknown[]) || []).map(Number).filter(Number.isInteger);
  const template = typeof req.body?.template === "string" ? req.body.template : "";
  if (!oids.length) throw new HttpError(400, "No recipients supplied");
  if (!template.trim()) throw new HttpError(400, "Message template is empty");

  await inngest.send({ name: "customers/notify.requested", data: { channel: "sms", oids, template } });
  res.status(202).json({ queued: oids.length });
});
