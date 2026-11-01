import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAdmin } from "@/lib/http";
import { assertServerConfig } from "@/lib/config";
import { getMaskedSettings, updateSettings, type SettingsPatch } from "@/lib/settings-store";

/**
 * Read / write the SECRET communication settings (SMS / Email / M-Pesa).
 * Admin-only. GET returns a MASKED view (no raw secrets ever leave the server);
 * PUT upserts the single Water_OrgSettings_Secure row — a blank secret field is
 * treated as "keep the stored value".
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET", "PUT");
  requireAdmin(req);
  assertServerConfig();

  if (req.method === "GET") {
    res.status(200).json(await getMaskedSettings());
    return;
  }

  // PUT
  const patch = (req.body || {}) as SettingsPatch;
  await updateSettings(patch);
  res.status(200).json(await getMaskedSettings());
});
