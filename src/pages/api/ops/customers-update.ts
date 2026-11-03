import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, getOpsUserToken, mapOpsDataError, HttpError } from "@/lib/http";
import { queryLayer, applyEdits } from "@/lib/arcgis";
import { updateAuthContact } from "@/lib/auth-store";
import { config } from "@/lib/config";

/**
 * Update a customer's editable details (name / phone / email) and cascade the
 * same fields to their portal login in the PRIVATE Water_CustomerAuth table.
 *
 * The login is matched by the customer's CURRENT email, so we read that first
 * (before the Water_Customers row changes) and then point the login at the new
 * values. The customer row is written under the operator's token (Model A); the
 * login sync runs with the admin token inside updateAuthContact.
 *
 * Body: { oid, cust_name, phone, email }  →  { objectId }
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "POST") throw new HttpError(405, `Method ${req.method} not allowed`);
  const token = await getOpsUserToken(req);

  const body = (req.body || {}) as Record<string, unknown>;
  const oid = Number(body.oid);
  const cust_name = typeof body.cust_name === "string" ? body.cust_name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null;
  if (!Number.isInteger(oid)) throw new HttpError(400, "Invalid customer id");
  if (!cust_name) throw new HttpError(400, "Customer name is required");
  if (!email) throw new HttpError(400, "Email is required");

  try {
    // The login is keyed by the pre-edit email — read it before updating the row.
    const rows = await queryLayer<{ email: string | null }>(
      config.layers.customers,
      { where: `objectid=${oid}`, outFields: "email" },
      token,
    );
    const currentEmail = rows[0]?.email || null;

    await applyEdits(
      config.layers.customers,
      { updates: [{ attributes: { objectid: oid, cust_name, phone, email } }] },
      token,
    );

    // Keep the portal login in sync (no-op if the customer has no login yet).
    if (currentEmail) {
      await updateAuthContact(currentEmail, { fullName: cust_name, phone, email });
    }

    res.status(200).json({ objectId: oid });
  } catch (err) {
    throw mapOpsDataError(err);
  }
});
