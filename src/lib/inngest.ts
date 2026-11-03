/**
 * Inngest client for the backend. Events are the durable queue behind the Bulk
 * SMS page's Resend / Delete actions: the API routes only `inngest.send(...)` an
 * event and return immediately; the matching functions in src/inngest/functions.ts
 * do the ArcGIS work in the background (with retries) so a slow Africastalking call
 * or a transient portal error never blocks the operator's click.
 *
 * In development you must run the Inngest dev server alongside `npm run dev`:
 *   npx inngest-cli@latest dev -u http://localhost:4000/api/inngest
 */
import { Inngest } from "inngest";

/** Strongly-typed event payloads this backend emits. */
export type AppEvents = {
  /** A customer was created in the operations console — provision their portal
   *  login (random temp password, must_reset) and email them the details. */
  "customer/created": { data: { email: string; fullName: string | null; phone: string | null } };
  /** Operator sent a templated SMS/email to selected customers. The template is
   *  rendered per-recipient (personalised) and delivered in the background. */
  "customers/notify.requested": {
    data: { channel: "sms" | "email"; oids: number[]; subject?: string; template: string };
  };
};

export const inngest = new Inngest({ id: "wsp-backend" });
