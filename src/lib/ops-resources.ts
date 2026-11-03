/**
 * Whitelisted data resources the operations console reads + edits through the
 * backend. Each entry maps a URL-safe resource name to its hosted layer URL, the
 * fields returned on a list query, a default sort, and the fields a write is
 * allowed to touch. Keeping this an explicit registry (rather than a generic
 * passthrough to any layer/field) means the `/api/ops/[resource]` routes can never
 * be used as an open proxy.
 *
 * Reads/writes both run with the server-side admin token (see arcgis.ts); the
 * browser never talks to ArcGIS directly.
 */
import { config } from "@/lib/config";
import { HttpError } from "@/lib/http";

export interface ResourceDef {
  layerUrl: string;
  /** Fields returned by GET (list). */
  outFields: string;
  /** Default orderByFields. */
  orderBy?: string;
  /** Fields a create/update may set. Empty ⇒ the resource is read-only. */
  writeFields: string[];
  /** Disallow POST (create) even though writeFields is non-empty. */
  noCreate?: boolean;
  /** Disallow DELETE. */
  noDelete?: boolean;
}

const L = config.layers;

export const RESOURCES: Record<string, ResourceDef> = {
  customers: {
    layerUrl: L.customers,
    outFields: "objectid,cust_name,phone,email,balance,num_connections",
    orderBy: "cust_name ASC",
    writeFields: ["cust_name", "phone", "email", "balance", "num_connections"],
  },
  "billing-cycles": {
    layerUrl: L.billingCycles,
    outFields: "objectid,cycle_name,status,start_date,end_date,invoices,unpaid,billed,collected",
    orderBy: "start_date DESC",
    writeFields: ["cycle_name", "status", "start_date", "end_date", "invoices", "unpaid", "billed", "collected"],
  },
  payments: {
    layerUrl: L.payments,
    outFields: "objectid,receipt_no,pay_date,cust_name,meter_no,pay_type,method,amount,billing_cycle,narration,pay_ts",
    orderBy: "pay_date DESC",
    writeFields: ["receipt_no", "cust_name", "meter_no", "pay_type", "method", "amount", "pay_date", "billing_cycle", "narration", "pay_ts"],
  },
  invoices: {
    layerUrl: L.invoices,
    outFields:
      "objectid,invoice_no,meter_no,cust_name,dma,billing_cycle,consumption,prev_balance,billed,total_payable,paid,balance,status,method,inv_date",
    orderBy: "inv_date DESC",
    writeFields: [], // read-only (invoices are generated elsewhere)
  },
  "field-workers": {
    layerUrl: L.fieldWorkers,
    outFields: "objectid,worker_name,org_username,is_meter_reader,is_technician,phone,active",
    orderBy: "worker_name ASC",
    writeFields: ["worker_name", "org_username", "is_meter_reader", "is_technician", "phone", "active"],
  },
  "org-members": {
    layerUrl: L.orgMembers,
    outFields: "objectid,username,full_name,email,is_admin",
    orderBy: "full_name ASC",
    writeFields: ["is_admin"], // members mirror the portal; only the admin flag is editable here
    noCreate: true,
    noDelete: true,
  },
  "incidence-types": {
    layerUrl: L.incidenceTypes,
    outFields: "objectid,type_name,description,default_priority,active",
    orderBy: "type_name ASC",
    writeFields: ["type_name", "description", "default_priority", "active"],
  },
  "work-order-types": {
    layerUrl: L.workOrderTypes,
    outFields: "objectid,type_name,description",
    orderBy: "type_name ASC",
    writeFields: ["type_name", "description"],
  },
  // NOTE: "org-settings" was retired — the Organization profile now lives in the
  // consolidated PRIVATE Water_Organization table, served by /api/ops/organization
  // (never through this generic passthrough, which would leak the secret columns).
  tariffs: {
    layerUrl: L.tariffs,
    outFields: "objectid,tariff_name,category,rate,min_charge,description",
    orderBy: "tariff_name ASC",
    writeFields: ["tariff_name", "category", "rate", "min_charge", "description"],
  },

  /* ---- Map pages: stats + data-table queries route through here; the map's
     own FeatureLayer rendering loads direct from the hosted service. ---- */
  "service-connections": {
    layerUrl: L.serviceConnections,
    outFields:
      "objectid,asset_id,customer,connection_date,meter_no,dma,latest_reading,prev_reading,outstanding_bill,conn_type,tariff,conn_status",
    orderBy: "customer ASC",
    // The connection Update dialog edits these; connections are created in the
    // utility-network editor, not here.
    writeFields: ["customer", "meter_no", "conn_type", "conn_status", "tariff"],
    noCreate: true,
  },
  "meter-readings": {
    layerUrl: L.meterReadings,
    outFields:
      "objectid,reading_no,billing_cycle,conn_asset_id,conn_oid,meter_no,cust_name,phone,email,dma,tariff,conn_type,prev_reading,current_reading,consumption,reading_date,meter_reader,assigned_date,due_date,reading_status",
    orderBy: "cust_name ASC",
    // Readings are generated per cycle elsewhere; the Consumption lasso → assign
    // flow only stamps the assigned reader + dates onto an existing row.
    writeFields: ["meter_reader", "assigned_date", "due_date"],
    noCreate: true,
    noDelete: true,
  },
  incidences: {
    layerUrl: L.incidences,
    outFields:
      "objectid,incident_no,type,description,reported_date,esritask_status,esritask_priority,esritask_assignee,esritask_duedate,esritask_notes",
    orderBy: "reported_date DESC",
    // Logged from the map (drop a pin → type + description); assignment edits
    // the task fields; a pin can be removed.
    writeFields: ["incident_no", "type", "description", "reported_date", "esritask_status", "esritask_priority", "esritask_assignee", "esritask_duedate", "esritask_notes"],
  },
  "maintenance-work-orders": {
    layerUrl: L.maintenanceWorkOrders,
    outFields: "objectid,wo_no,conn_oid,wo_type,field_worker,due_date,notes,status,created_date",
    orderBy: "due_date ASC",
    writeFields: ["wo_no", "conn_oid", "wo_type", "field_worker", "due_date", "notes", "status", "created_date"],
  },
  "meter-read-work-orders": {
    layerUrl: L.meterReadWorkOrders,
    outFields: "objectid,meter_no,cycle_name,esritask_assignee,esritask_duedate,esritask_notes,esritask_status,esritask_priority",
    orderBy: "esritask_duedate ASC",
    writeFields: ["meter_no", "cycle_name", "esritask_assignee", "esritask_duedate", "esritask_notes", "esritask_status", "esritask_priority"],
  },

  /* ---- Zoning ---- */
  // Zone polygons (the utility-network "Zones" layer). Read-only here — zones are
  // drawn/edited in the utility-network editor. The Zoning page reads the list from
  // here and renders the polygon on its own map directly from the hosted service.
  zones: {
    layerUrl: L.zones,
    outFields: "objectid,name,dma,status",
    orderBy: "name ASC",
    writeFields: [],
    noCreate: true,
    noDelete: true,
  },
  // Operator-entered supply per zone (keyed by the zone's dma/name string). Each
  // record covers a supply period: supply_date = period start, period_end = end.
  "zone-supply": {
    layerUrl: L.zoneSupply,
    outFields: "objectid,zone,supply_date,period_end,supply_m3,notes",
    orderBy: "supply_date DESC",
    writeFields: ["zone", "supply_date", "period_end", "supply_m3", "notes"],
  },
};

/** Look up a resource definition or 404. */
export function getResource(name: string): ResourceDef {
  const def = RESOURCES[name];
  if (!def) throw new HttpError(404, `Unknown resource: ${name}`);
  return def;
}

/** Keep only the attributes a write is allowed to set for this resource. */
export function pickWritable(def: ResourceDef, attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of def.writeFields) {
    if (Object.prototype.hasOwnProperty.call(attrs, k)) out[k] = attrs[k];
  }
  return out;
}
