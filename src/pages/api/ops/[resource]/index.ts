import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, getOpsUserToken, mapOpsDataError, HttpError } from "@/lib/http";
import { queryLayer, insertOne } from "@/lib/arcgis";
import { getResource, pickWritable } from "@/lib/ops-resources";

/**
 * List (GET) + create (POST) for a whitelisted ops resource. Both run under the
 * signed-in operator's ArcGIS token (Model A), so the portal enforces what they
 * may see/edit. GET returns `{ items }`; POST accepts the record's attributes at
 * the top level (optionally plus a `geometry`) and returns `{ objectId }`.
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  const token = await getOpsUserToken(req);
  const def = getResource(String(req.query.resource));

  if (req.method === "GET") {
    const whereRaw = typeof req.query.where === "string" ? req.query.where.slice(0, 1000) : "";
    const orderBy = typeof req.query.orderBy === "string" ? req.query.orderBy : def.orderBy;
    try {
      const items = await queryLayer(def.layerUrl, {
        where: whereRaw || "1=1",
        outFields: def.outFields,
        orderByFields: orderBy,
      }, token);
      res.status(200).json({ items });
    } catch (err) {
      throw mapOpsDataError(err);
    }
    return;
  }

  if (req.method === "POST") {
    if (!def.writeFields.length || def.noCreate) throw new HttpError(405, "This resource is read-only");
    const { geometry, ...rest } = (req.body || {}) as Record<string, unknown>;
    const attrs = pickWritable(def, rest);
    if (!Object.keys(attrs).length) throw new HttpError(400, "No writable fields supplied");
    try {
      const objectId = await insertOne(def.layerUrl, attrs, geometry as Record<string, unknown> | undefined, token);
      res.status(201).json({ objectId });
    } catch (err) {
      throw mapOpsDataError(err);
    }
    return;
  }

  throw new HttpError(405, `Method ${req.method} not allowed`);
});
