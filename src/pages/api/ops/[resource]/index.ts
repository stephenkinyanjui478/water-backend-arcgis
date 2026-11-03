import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, getOpsUserToken, mapOpsDataError, HttpError } from "@/lib/http";
import { queryLayer, countLayer, insertOne } from "@/lib/arcgis";
import { getResource, pickWritable } from "@/lib/ops-resources";
import { inngest } from "@/lib/inngest";

/**
 * List (GET) + create (POST) for a whitelisted ops resource. Both run under the
 * signed-in operator's ArcGIS token (Model A), so the portal enforces what they
 * may see/edit. GET returns `{ items }`, or `{ items, total }` when a `limit`
 * query param requests a page (`offset`/`limit` → ArcGIS resultOffset/resultRecordCount,
 * `total` from a matching count query). POST accepts the record's attributes at
 * the top level (optionally plus a `geometry`) and returns `{ objectId }`.
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  const token = await getOpsUserToken(req);
  const def = getResource(String(req.query.resource));

  if (req.method === "GET") {
    const whereRaw = typeof req.query.where === "string" ? req.query.where.slice(0, 1000) : "";
    const where = whereRaw || "1=1";
    const orderBy = typeof req.query.orderBy === "string" ? req.query.orderBy : def.orderBy;
    // Optional server-side paging: ?limit=N[&offset=M] → one page + a total count.
    const limit = Number(req.query.limit);
    const offset = Number(req.query.offset);
    const paginated = Number.isInteger(limit) && limit > 0;
    try {
      const items = await queryLayer(def.layerUrl, {
        where,
        outFields: def.outFields,
        orderByFields: orderBy,
        resultRecordCount: paginated ? limit : undefined,
        resultOffset: paginated && Number.isInteger(offset) && offset > 0 ? offset : undefined,
      }, token);
      if (paginated) {
        const total = await countLayer(def.layerUrl, where, token);
        res.status(200).json({ items, total });
      } else {
        res.status(200).json({ items });
      }
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

      // A new customer with an email gets a portal login + welcome email, handled
      // off the request path by Inngest. Never let a queue hiccup fail the create.
      if (String(req.query.resource) === "customers" && typeof attrs.email === "string" && attrs.email) {
        try {
          await inngest.send({
            name: "customer/created",
            data: {
              email: attrs.email,
              fullName: (attrs.cust_name as string) || null,
              phone: (attrs.phone as string) || null,
            },
          });
        } catch (e) {
          console.error("[ops/customers] failed to queue welcome email:", e);
        }
      }

      res.status(201).json({ objectId });
    } catch (err) {
      throw mapOpsDataError(err);
    }
    return;
  }

  throw new HttpError(405, `Method ${req.method} not allowed`);
});
