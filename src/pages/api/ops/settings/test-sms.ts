import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireOps, HttpError } from "@/lib/http";
import { sendSms } from "@/lib/sms";

/** Send a test SMS using the saved Africastalking config (ops-gated). */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "POST");
  requireOps(req);

  const { to } = (req.body || {}) as Record<string, string>;
  if (!to) throw new HttpError(400, "A recipient phone number is required");

  const result = await sendSms(to, "WSP test message — your SMS settings are working.");
  res.status(200).json({ ok: true, recipients: result.recipients });
});
