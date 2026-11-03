/**
 * Inngest serve endpoint. The Inngest dev server (and, in production, Inngest
 * Cloud) calls this URL to discover the functions and to invoke them when their
 * events fire. Run locally with:
 *   npx inngest-cli@latest dev -u http://localhost:4000/api/inngest
 */
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { functions } from "@/inngest/functions";

export default serve({ client: inngest, functions });
