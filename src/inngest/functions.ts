/**
 * Background Inngest jobs for the backend. Each runs with the admin token so the
 * work doesn't depend on an operator session still being open when it runs.
 *
 *   sendCustomerWelcome — provision a new customer's portal login + welcome email.
 *   notifyCustomers     — send a templated, per-recipient SMS/email to a selection.
 */
import { inngest } from "@/lib/inngest";
import { queryLayer } from "@/lib/arcgis";
import { sendSms } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { findAuth, createAuth, generateTempPassword } from "@/lib/auth-store";
import { renderTemplate, type TemplateCustomer } from "@/lib/message-template";
import { config } from "@/lib/config";

/**
 * Welcome a newly-created customer: provision their portal login with a random
 * temporary password (must_reset = 1) and email them the sign-in details. Runs
 * with the backend admin token (Water_CustomerAuth is private), independent of
 * the operator session that triggered the create.
 *
 * Steps are split so Inngest memoises each one across retries: the login is
 * created exactly once, and the (one-time) plain password generated inside that
 * step is reused by the email step even if the email send is retried.
 */
export const sendCustomerWelcome = inngest.createFunction(
  { id: "customer-welcome", name: "Welcome new customer", retries: 3, triggers: [{ event: "customer/created" }] },
  async ({ event, step }) => {
    const { email, fullName, phone } = event.data as { email: string; fullName: string | null; phone: string | null };
    if (!email) return { skipped: "no email" };

    // Don't clobber an existing login (e.g. the customer already self-registered).
    const existing = await step.run("check-existing", () => findAuth(email));
    if (existing) return { email, skipped: "login already exists" };

    // Create the login + mint the temporary password in one memoised step, so a
    // later retry never creates a second row or a second password.
    const tempPassword = await step.run("create-login", async () => {
      const pwd = generateTempPassword(8);
      await createAuth({ email, password: pwd, fullName, phone, mustReset: true });
      return pwd;
    });

    await step.run("send-welcome-email", async () => {
      const portal = config.customerPortalUrl;
      const name = fullName || "there";
      const subject = "Your water account portal login";
      const text =
        `Hi ${name},\n\n` +
        `An account has been created for you on the water services customer portal.\n\n` +
        `Sign in here: ${portal}\n` +
        `Email: ${email}\n` +
        `Temporary password: ${tempPassword}\n\n` +
        `For your security you'll be asked to set a new password the first time you sign in.\n\n` +
        `If you didn't expect this email, please contact support.`;
      const html =
        `<p>Hi ${name},</p>` +
        `<p>An account has been created for you on the water services customer portal.</p>` +
        `<p><a href="${portal}">Sign in to the portal</a></p>` +
        `<table cellpadding="6" style="border-collapse:collapse">` +
        `<tr><td><strong>Email</strong></td><td>${email}</td></tr>` +
        `<tr><td><strong>Temporary password</strong></td><td><code>${tempPassword}</code></td></tr>` +
        `</table>` +
        `<p>For your security you'll be asked to set a new password the first time you sign in.</p>` +
        `<p style="color:#6a6a6a;font-size:12px">If you didn't expect this email, please contact support.</p>`;
      await sendEmail({ to: email, subject, text, html });
      return { sent: true };
    });

    return { email, status: "welcomed" };
  },
);

/**
 * Send a templated SMS or email to a set of selected customers, personalising
 * each message from the recipient's own record. Runs with the backend admin
 * token. Each recipient is its own memoised step so (a) an Inngest retry never
 * re-sends an already-delivered message and (b) one bad address/number doesn't
 * abort the batch — failures are just counted. Messages are not stored.
 */
interface NotifyCustomerRow {
  objectid: number;
  cust_name: string | null;
  phone: string | null;
  email: string | null;
  balance: number | null;
}

export const notifyCustomers = inngest.createFunction(
  { id: "customers-notify", name: "Notify customers", retries: 2, triggers: [{ event: "customers/notify.requested" }] },
  async ({ event, step }) => {
    const { channel, subject, template } = event.data as {
      channel: "sms" | "email";
      subject?: string;
      template: string;
    };
    const ids = ((event.data as { oids: number[] }).oids || []).map(Number).filter(Number.isInteger);
    if (!ids.length || !template?.trim()) return { sent: 0, skipped: "no recipients or empty template" };

    const customers = await step.run("load-customers", () =>
      queryLayer<NotifyCustomerRow>(config.layers.customers, {
        where: `objectid IN (${ids.join(",")})`,
        outFields: "objectid,cust_name,phone,email,balance",
      }),
    );

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const c of customers) {
      const dest = channel === "sms" ? c.phone : c.email;
      if (!dest) {
        skipped++;
        continue;
      }
      const result = await step.run(`${channel}-${c.objectid}`, async () => {
        const body = renderTemplate(template, c as TemplateCustomer);
        try {
          if (channel === "sms") {
            await sendSms(c.phone!, body);
          } else {
            const subj = renderTemplate(subject || "", c as TemplateCustomer).trim() || "A message from your water utility";
            await sendEmail({ to: c.email!, subject: subj, text: body });
          }
          return { ok: true };
        } catch {
          // Messages aren't stored; a failed recipient is just counted so one bad
          // number/address doesn't abort the batch.
          return { ok: false };
        }
      });
      if (result.ok) sent++;
      else failed++;
    }

    return { channel, sent, failed, skipped };
  },
);

export const functions = [sendCustomerWelcome, notifyCustomers];
