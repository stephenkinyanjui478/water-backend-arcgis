import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireOps } from "@/lib/http";
import { assertServerConfig } from "@/lib/config";
import { getMaskedSettings, updateSettings, type SettingsPatch } from "@/lib/settings-store";

/**
 * Operations-console view of the SECRET communication settings (SMS / Email /
 * M-Pesa). Identical behaviour to the admin route, but gated by the ops OAuth
 * session instead of the admin password. GET returns a MASKED view (no raw
 * secrets leave the server); PUT upserts the single secure row — a blank secret
 * field keeps the stored value.
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET", "PUT");
  requireOps(req);
  assertServerConfig();

  if (req.method === "GET") {
    res.status(200).json(await getMaskedSettings());
    return;
  }

  await updateSettings((req.body || {}) as SettingsPatch);
  res.status(200).json(await getMaskedSettings());
});
