import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth } from "@/lib/http";
import { getCustomerMeters } from "@/lib/customers";

/** List the meters ("accounts") owned by the signed-in customer. */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET");
  const claims = requireAuth(req);
  const meters = await getCustomerMeters(claims.email);
  res.status(200).json({ meters });
});
