import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, getOpsUserToken, mapOpsDataError, HttpError } from "@/lib/http";
import { applyEdits } from "@/lib/arcgis";
import { getResource, pickWritable } from "@/lib/ops-resources";

/**
 * Update (PATCH) + delete (DELETE) a single record of a whitelisted ops resource,
 * identified by its OBJECTID. Both run under the signed-in operator's ArcGIS token
 * (Model A) — the portal enforces whether they may edit/delete the feature.
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  const token = await getOpsUserToken(req);
  const def = getResource(String(req.query.resource));
  const oid = Number(req.query.oid);
  if (!Number.isInteger(oid)) throw new HttpError(400, "Invalid record id");

  if (req.method === "PATCH" || req.method === "PUT") {
    if (!def.writeFields.length) throw new HttpError(405, "This resource is read-only");
    const attrs = pickWritable(def, (req.body || {}) as Record<string, unknown>);
    if (!Object.keys(attrs).length) throw new HttpError(400, "No writable fields supplied");
    try {
      await applyEdits(def.layerUrl, { updates: [{ attributes: { objectid: oid, ...attrs } }] }, token);
      res.status(200).json({ objectId: oid });
    } catch (err) {
      throw mapOpsDataError(err);
    }
    return;
  }

  if (req.method === "DELETE") {
    if (def.noDelete) throw new HttpError(405, "This resource cannot be deleted");
    try {
      await applyEdits(def.layerUrl, { deletes: [oid] }, token);
      res.status(200).json({ objectId: oid });
    } catch (err) {
      throw mapOpsDataError(err);
    }
    return;
  }

  throw new HttpError(405, `Method ${req.method} not allowed`);
});
