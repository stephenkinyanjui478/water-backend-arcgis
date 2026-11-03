import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth } from "@/lib/http";
import { findAuth } from "@/lib/auth-store";

export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET");
  const claims = requireAuth(req);
  const row = await findAuth(claims.email);
  res.status(200).json({
    user: {
      email: claims.email,
      name: row?.full_name ?? claims.name ?? null,
      phone: row?.phone ?? null,
      mustReset: row?.must_reset === 1,
    },
  });
});
