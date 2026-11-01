import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAdmin, HttpError } from "@/lib/http";
import { sendSms } from "@/lib/sms";

/** Send a test SMS to the supplied number using the saved Africastalking config. */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "POST");
  requireAdmin(req);

  const { to } = (req.body || {}) as Record<string, string>;
  if (!to) throw new HttpError(400, "A recipient phone number is required");

  const result = await sendSms(to, "WSP test message — your SMS settings are working.");
  res.status(200).json({ ok: true, recipients: result.recipients });
});
