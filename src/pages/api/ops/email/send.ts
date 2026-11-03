import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireOps, HttpError } from "@/lib/http";
import { inngest } from "@/lib/inngest";

/**
 * Queue a templated email to the selected customers (by Water_Customers OBJECTID).
 * Subject and body are both templates, rendered per-recipient by the
 * notifyCustomers Inngest function, which sends each message in the background.
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireOps(req);
  if (req.method !== "POST") throw new HttpError(405, `Method ${req.method} not allowed`);

  const oids = ((req.body?.oids as unknown[]) || []).map(Number).filter(Number.isInteger);
  const subject = typeof req.body?.subject === "string" ? req.body.subject : "";
  const template = typeof req.body?.template === "string" ? req.body.template : "";
  if (!oids.length) throw new HttpError(400, "No recipients supplied");
  if (!subject.trim()) throw new HttpError(400, "Subject is required");
  if (!template.trim()) throw new HttpError(400, "Message body is empty");

  await inngest.send({ name: "customers/notify.requested", data: { channel: "email", oids, subject, template } });
  res.status(202).json({ queued: oids.length });
});
