import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, getOpsUserToken, mapOpsDataError, HttpError } from "@/lib/http";
import { queryLayer, sqlEscape } from "@/lib/arcgis";
import { config } from "@/lib/config";

/**
 * Supply + losses analytics for one zone (by its DMA label). Returns the daily
 * supply series (operator entries in Water_ZoneSupply) and the monthly metered
 * consumption (summed live from Water_MeterReadings, keyed by billing_cycle). The
 * Zoning page buckets supply into week/month/year and computes losses / NRW per
 * month = supply − metered client-side. Runs under the operator's ArcGIS token.
 */
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "May 2026" → "2026-05" (null if unparseable). */
function toYm(cycle: string | null | undefined): string | null {
  if (!cycle) return null;
  const [name, year] = String(cycle).trim().toLowerCase().split(/\s+/);
  const mi = MONTHS.indexOf(name);
  const y = Number(year);
  if (mi < 0 || !Number.isInteger(y)) return null;
  return `${y}-${String(mi + 1).padStart(2, "0")}`;
}

interface SupplyRow { supply_date: number | null; supply_m3: number | null }
interface MeteredRow { billing_cycle: string | null; metered: number | null }

export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  const token = await getOpsUserToken(req);
  if (req.method !== "GET") throw new HttpError(405, `Method ${req.method} not allowed`);

  const zone = String(req.query.zone || "").trim();
  if (!zone) throw new HttpError(400, "Zone is required");
  const esc = sqlEscape(zone);

  try {
    const [supply, metered] = await Promise.all([
      queryLayer<SupplyRow>(config.layers.zoneSupply, {
        where: `zone='${esc}'`,
        outFields: "supply_date,supply_m3",
        orderByFields: "supply_date ASC",
      }, token),
      queryLayer<MeteredRow>(config.layers.meterReadings, {
        where: `dma='${esc}'`,
        outFields: "billing_cycle",
        groupByFieldsForStatistics: "billing_cycle",
        outStatistics: [{ statisticType: "sum", onStatisticField: "consumption", outStatisticFieldName: "metered" }],
      }, token),
    ]);

    const supplyDaily = supply
      .filter((r) => r.supply_date != null)
      .map((r) => ({ t: Number(r.supply_date), v: Number(r.supply_m3 ?? 0) }));

    // Collapse metered to a YYYY-MM keyed map (a cycle that doesn't parse is dropped).
    const meteredByYm: Record<string, number> = {};
    for (const r of metered) {
      const ym = toYm(r.billing_cycle);
      const v = Number(r.metered);
      if (!ym || !Number.isFinite(v)) continue;
      meteredByYm[ym] = (meteredByYm[ym] || 0) + v;
    }
    const meteredMonthly = Object.entries(meteredByYm)
      .map(([ym, v]) => ({ ym, v }))
      .sort((a, b) => (a.ym < b.ym ? -1 : 1));

    res.status(200).json({ zone, supplyDaily, meteredMonthly });
  } catch (err) {
    throw mapOpsDataError(err);
  }
});
