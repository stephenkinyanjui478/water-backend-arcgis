import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireOps, HttpError } from "@/lib/http";
import { sendEmail } from "@/lib/email";

/** Send a test email using the saved SMTP config (ops-gated). */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "POST");
  requireOps(req);

  const { to } = (req.body || {}) as Record<string, string>;
  if (!to) throw new HttpError(400, "A recipient email address is required");

  const result = await sendEmail({
    to,
    subject: "WSP test email",
    text: "This is a test email — your SMTP settings are working.",
  });
  res.status(200).json({ ok: true, messageId: result.messageId });
});
