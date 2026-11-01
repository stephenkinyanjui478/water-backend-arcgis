import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, getOpsUserToken } from "@/lib/http";
import { config } from "@/lib/config";
import { queryLayer } from "@/lib/arcgis";

/**
 * Normalised field-task feed for the Field Works → Overview tab. Aggregates the
 * three task layers (incidences, maintenance work orders, meter-read work orders)
 * server-side and resolves each assignee's org-username to a worker name, so the
 * console can compute its tiles/charts without touching ArcGIS directly.
 */

// esritask_status code → canonical label (matches client config taskStatus).
const CANON = ["Unassigned", "Assigned", "In Progress", "Completed"];

interface NormTask {
  source: string;
  assignee: string | null;
  worker: string;
  statusLabel: string;
  priority: number | null;
  due: number | null;
  start: number | null;
  completed: number | null;
}

export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET");
  const token = await getOpsUserToken(req);

  // Resolve org_username → worker_name for assignee display.
  const workers = await queryLayer<any>(config.layers.fieldWorkers, {
    outFields: "worker_name,org_username",
  }, token).catch(() => []);
  const nameByUser: Record<string, string> = {};
  for (const w of workers) if (w.org_username) nameByUser[w.org_username] = w.worker_name;
  const resolve = (a: string | null) => (a ? nameByUser[a] || a : "");

  const sources = [
    {
      label: "Incidences",
      url: config.layers.incidences,
      fields: "type,esritask_assignee,esritask_status,esritask_priority,esritask_duedate,reported_date,completed_date",
      norm: (a: any): NormTask => ({
        source: "Incidences",
        assignee: a.esritask_assignee ?? null,
        worker: resolve(a.esritask_assignee),
        statusLabel: CANON[Number(a.esritask_status)] ?? "Unassigned",
        priority: a.esritask_priority != null ? Number(a.esritask_priority) : null,
        due: a.esritask_duedate ?? null,
        start: a.reported_date ?? null,
        completed: a.completed_date ?? null,
      }),
    },
    {
      label: "Maintenance",
      url: config.layers.maintenanceWorkOrders,
      fields: "wo_type,field_worker,status,due_date,created_date,completed_date",
      norm: (a: any): NormTask => {
        const s = a.status === "Completed" ? "Completed" : a.status === "In Progress" ? "In Progress" : a.field_worker ? "Assigned" : "Unassigned";
        return {
          source: "Maintenance",
          assignee: a.field_worker ?? null,
          worker: resolve(a.field_worker),
          statusLabel: s,
          priority: null,
          due: a.due_date ?? null,
          start: a.created_date ?? null,
          completed: a.completed_date ?? null,
        };
      },
    },
    {
      label: "Meter reads",
      url: config.layers.meterReadWorkOrders,
      fields: "esritask_assignee,esritask_status,esritask_duedate,completed_date,cycle_name",
      norm: (a: any): NormTask => ({
        source: "Meter reads",
        assignee: a.esritask_assignee ?? null,
        worker: resolve(a.esritask_assignee),
        statusLabel: CANON[Number(a.esritask_status)] ?? "Unassigned",
        priority: null,
        due: a.esritask_duedate ?? null,
        start: null,
        completed: a.completed_date ?? null,
      }),
    },
  ];

  const results = await Promise.all(
    sources.map(async (src) => {
      try {
        const rows = await queryLayer<any>(src.url, { outFields: src.fields }, token);
        return rows.map(src.norm);
      } catch {
        return [];
      }
    })
  );

  res.status(200).json({ tasks: results.flat() });
});
