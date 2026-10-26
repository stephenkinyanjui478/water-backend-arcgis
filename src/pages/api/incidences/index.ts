import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth, HttpError } from "@/lib/http";
import { assertOwnsMeter } from "@/lib/customers";
import { config } from "@/lib/config";
import { queryLayer, insertOne, sqlEscape } from "@/lib/arcgis";

const TASK_STATUS_LABELS: Record<number, string> = {
  0: "Unassigned",
  1: "Assigned",
  2: "In Progress",
  3: "Completed",
};
const TASK_PRIORITY_LABELS: Record<number, string> = {
  0: "None",
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Critical",
};

function newIncidentNo(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `INC-${stamp}-${rand}`;
}

export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  const claims = requireAuth(req);

  if (req.method === "GET") {
    const rows = await queryLayer<any>(config.layers.incidences, {
      where: `LOWER(reporter_email)='${sqlEscape(claims.email.toLowerCase())}'`,
      outFields:
        "objectid,incident_no,type,description,reported_date,meter_no,esritask_status,esritask_priority,esritask_assignee,esritask_duedate,completed_date",
      orderByFields: "reported_date DESC",
    });
    const incidences = rows.map((r) => ({
      objectId: r.objectid,
      incidentNo: r.incident_no,
      type: r.type,
      description: r.description,
      reportedDate: r.reported_date,
      meterNo: r.meter_no,
      status: TASK_STATUS_LABELS[r.esritask_status] ?? "Unassigned",
      priority: TASK_PRIORITY_LABELS[r.esritask_priority] ?? "None",
      assignee: r.esritask_assignee,
      dueDate: r.esritask_duedate,
      completedDate: r.completed_date,
    }));
    res.status(200).json({ incidences });
    return;
  }

  requireMethod(req, "POST");
  const body = (req.body || {}) as Record<string, unknown>;
  const type = typeof body.type === "string" ? body.type : "";
  const description = typeof body.description === "string" ? body.description : "";
  const meterNo = typeof body.meterNo === "string" ? body.meterNo : "";
  const phone = typeof body.phone === "string" ? body.phone : "";
  if (!type) throw new HttpError(400, "Incident type is required");
  if (!description || description.trim().length < 5) {
    throw new HttpError(400, "Please describe the incident (at least 5 characters)");
  }

  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
  if (!hasLocation) throw new HttpError(400, "A location is required — drag the map to the incident spot");
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new HttpError(400, "The location is out of range");
  }

  if (meterNo) await assertOwnsMeter(claims.email, meterNo);

  // Default priority from the catalog, falling back to Medium (2).
  let priority = 2;
  const typeRow = await queryLayer<any>(config.layers.incidenceTypes, {
    where: `type_name='${sqlEscape(type)}'`,
    outFields: "default_priority",
  });
  if (typeRow[0] && typeRow[0].default_priority != null) priority = Number(typeRow[0].default_priority);

  const incident_no = newIncidentNo();
  await insertOne(
    config.layers.incidences,
    {
      incident_no,
      type,
      description: description.trim(),
      reported_date: Date.now(),
      reporter_email: claims.email.toLowerCase(),
      reporter_phone: phone || null,
      meter_no: meterNo || null,
      channel: "Customer Portal",
      esritask_status: 0, // Unassigned
      esritask_priority: priority,
    },
    { x: longitude, y: latitude, spatialReference: { wkid: 4326 } }
  );

  res.status(201).json({ incidentNo: incident_no });
});
