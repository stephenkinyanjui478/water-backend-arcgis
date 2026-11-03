/**
 * Message templating for operator-sent SMS/email. A single template is written
 * once and rendered per recipient so every message is personalised. Tokens are
 * case-insensitive and wrapped in braces, e.g. `Hi {name}, your balance is {balance}.`
 *
 * NOTE: the operations console mirrors this exact logic for its live preview
 * (operations-console/src/lib/messageTemplate.ts). Keep the two in sync.
 */
export interface TemplateCustomer {
  cust_name?: string | null;
  phone?: string | null;
  email?: string | null;
  balance?: number | null;
}

/** The tokens an operator may use, with a human label for the compose UI. */
export const TEMPLATE_TOKENS: Array<{ token: string; label: string }> = [
  { token: "{name}", label: "Customer name" },
  { token: "{phone}", label: "Phone" },
  { token: "{email}", label: "Email" },
  { token: "{balance}", label: "Balance" },
];

export function formatKes(value: number | null | undefined): string {
  return "KES " + Number(value || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function renderTemplate(template: string, c: TemplateCustomer): string {
  return template
    .replace(/\{name\}/gi, (c.cust_name || "customer").trim())
    .replace(/\{phone\}/gi, c.phone || "")
    .replace(/\{email\}/gi, c.email || "")
    .replace(/\{balance\}/gi, formatKes(c.balance));
}
