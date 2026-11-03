import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, getOpsUserToken, mapOpsDataError, HttpError } from "@/lib/http";
import { queryLayer, applyEdits } from "@/lib/arcgis";
import { deleteAuthByEmail } from "@/lib/auth-store";
import { config } from "@/lib/config";

/**
 * Delete one or more customers (by Water_Customers OBJECTID) and cascade the
 * removal to their portal login in the PRIVATE Water_CustomerAuth table.
 *
 * Rules enforced server-side (not just in the UI):
 *   • A customer with num_connections > 0 is NEVER deleted — those OBJECTIDs are
 *     reported back as `blocked` and left untouched.
 *   • For each deletable customer, their login is revoked FIRST (admin token),
 *     then the Water_Customers row is deleted under the operator's token.
 *
 * Body: { oids: number[] }  →  { deleted: number, blocked: number[] }
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "POST") throw new HttpError(405, `Method ${req.method} not allowed`);
  const token = await getOpsUserToken(req);

  const oids = ((req.body?.oids as unknown[]) || []).map(Number).filter(Number.isInteger);
  if (!oids.length) throw new HttpError(400, "No customer ids supplied");

  try {
    const rows = await queryLayer<{ objectid: number; email: string | null; num_connections: number | null }>(
      config.layers.customers,
      { where: `objectid IN (${oids.join(",")})`, outFields: "objectid,email,num_connections" },
      token,
    );

    const blocked = rows.filter((r) => (r.num_connections ?? 0) > 0).map((r) => r.objectid);
    const deletable = rows.filter((r) => (r.num_connections ?? 0) <= 0);

    if (deletable.length) {
      // Revoke portal logins first (admin token) so a removed customer can't sign in,
      // then drop the customer rows (operator token). Attachments go with the row.
      const emails = [...new Set(deletable.map((r) => r.email).filter((e): e is string => !!e))];
      for (const email of emails) await deleteAuthByEmail(email);

      await applyEdits(config.layers.customers, { deletes: deletable.map((r) => r.objectid) }, token);
    }

    res.status(200).json({ deleted: deletable.length, blocked });
  } catch (err) {
    throw mapOpsDataError(err);
  }
});
