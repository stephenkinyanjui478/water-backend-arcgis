/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireOps } from "@/lib/http";
import { getAdminToken } from "@/lib/arcgis";
import { config } from "@/lib/config";

/**
 * Read-only list of the portal GROUPS that back "Users & Access → Groups".
 *
 * Only groups that are OWNED BY THE ADMIN (the content owner, config.arcgis.user)
 * AND carry the `water` tag are returned — so the console shows just this project's
 * groups, never the owner's other ~dozen groups. Operators can view them but cannot
 * create groups (there is no POST here).
 *
 * The portal is searched with the admin token; each group's member count and the
 * owner's display name are resolved so the UI can render the group cards.
 */
interface GroupCard {
  id: string;
  title: string;
  snippet: string;
  description: string;
  created: number | null;
  modified: number | null;
  access: string; // "private" | "org" | "public"
  memberCount: number;
  owner: string;
  ownerFullName: string;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Referer: config.arcgis.referer } });
  const json = await res.json().catch(() => null);
  if (!json || json.error) throw new Error(`portal request failed: ${JSON.stringify(json?.error || `HTTP ${res.status}`)}`);
  return json;
}

export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET");
  requireOps(req);

  const token = await getAdminToken();
  const t = encodeURIComponent(token);
  const owner = config.arcgis.user;

  // Groups owned by the admin that are tagged `water`.
  const q = encodeURIComponent(`owner:"${owner}" AND tags:"water"`);
  const search = await getJson(`${config.portal}/sharing/rest/community/groups?q=${q}&num=100&f=json&token=${t}`);
  const results: any[] = Array.isArray(search.results) ? search.results : [];

  // Resolve owner display names once per unique owner.
  const nameCache = new Map<string, string>();
  const fullName = async (username: string): Promise<string> => {
    if (nameCache.has(username)) return nameCache.get(username)!;
    let name = username;
    try {
      const u = await getJson(`${config.portal}/sharing/rest/community/users/${encodeURIComponent(username)}?f=json&token=${t}`);
      if (typeof u.fullName === "string" && u.fullName) name = u.fullName;
    } catch { /* fall back to username */ }
    nameCache.set(username, name);
    return name;
  };

  const items: GroupCard[] = await Promise.all(
    results.map(async (g): Promise<GroupCard> => {
      let memberCount = 0;
      try {
        const u = await getJson(`${config.portal}/sharing/rest/community/groups/${g.id}/users?f=json&token=${t}`);
        const members = new Set<string>([
          ...(u.owner ? [u.owner] : []),
          ...(Array.isArray(u.admins) ? u.admins : []),
          ...(Array.isArray(u.users) ? u.users : []),
        ]);
        memberCount = members.size;
      } catch { /* leave 0 if the member list isn't readable */ }
      return {
        id: g.id,
        title: g.title || "Untitled group",
        snippet: g.snippet || "",
        description: g.description || "",
        created: typeof g.created === "number" ? g.created : null,
        modified: typeof g.modified === "number" ? g.modified : null,
        access: g.access || "private",
        memberCount,
        owner: g.owner || owner,
        ownerFullName: await fullName(g.owner || owner),
      };
    })
  );

  items.sort((a, b) => a.title.localeCompare(b.title));
  res.status(200).json({ items });
});
