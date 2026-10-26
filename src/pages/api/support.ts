import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth } from "@/lib/http";

/**
 * Support / contact details for customers. These are configurable via env so the
 * utility can update them without a code change; sensible defaults otherwise.
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET");
  requireAuth(req);
  res.status(200).json({
    support: {
      utility: process.env.SUPPORT_UTILITY || "WSP Water Utility",
      callCentre: process.env.SUPPORT_PHONE || "+254 20 000 0000",
      emergencyLine: process.env.SUPPORT_EMERGENCY || "+254 700 000 000",
      whatsapp: process.env.SUPPORT_WHATSAPP || "+254 700 000 000",
      email: process.env.SUPPORT_EMAIL || "support@wsp.co.ke",
      hours: process.env.SUPPORT_HOURS || "Mon–Fri 8:00–17:00, Sat 9:00–13:00",
      address: process.env.SUPPORT_ADDRESS || "WSP House, Nairobi, Kenya",
      payBill: process.env.MPESA_SHORTCODE || "",
    },
  });
});
