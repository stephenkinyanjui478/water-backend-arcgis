/**
 * SMTP email sender (Nodemailer). The transport config comes from the settings
 * store (admin Organization page) with env fallback. A fresh transport is built
 * per send (settings can change at runtime); this is fine for the low volume of
 * transactional / test mail here.
 */
import nodemailer from "nodemailer";
import { getEffectiveSmtp } from "@/lib/settings-store";

export interface SendMailInput {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail(input: SendMailInput): Promise<{ messageId: string }> {
  const smtp = await getEffectiveSmtp();
  if (!smtp.host || !smtp.port) {
    throw new Error("Email is not configured (missing SMTP host / port).");
  }
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  const from = smtp.from || smtp.user;
  if (!from) throw new Error("Email is not configured (missing From address).");

  const info = await transport.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
  return { messageId: info.messageId };
}
