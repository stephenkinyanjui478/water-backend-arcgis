import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth } from "@/lib/http";
import { config } from "@/lib/config";
import { queryLayer } from "@/lib/arcgis";

/** Active incidence types for the "report an incident" form's dropdown. */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET");
  requireAuth(req);
  const rows = await queryLayer<any>(config.layers.incidenceTypes, {
    where: "active='Yes'",
    outFields: "type_name,description,default_priority",
    orderByFields: "type_name ASC",
  });
  const types = rows.map((r) => ({
    name: r.type_name,
    description: r.description,
    defaultPriority: r.default_priority,
  }));
  res.status(200).json({ types });
});
