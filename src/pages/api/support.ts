import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth } from "@/lib/http";
import { getSupportContacts } from "@/lib/settings-store";

/**
 * Support / contact details for customers, read from the single Water_Organization
 * row (managed on the operations-console Organization page) with the backend admin
 * token. Returns the organization name, support phone lines, WhatsApp link, email
 * and the M-Pesa Pay Bill shortcode.
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET");
  requireAuth(req);
  res.status(200).json({ support: await getSupportContacts() });
});
