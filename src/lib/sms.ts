/**
 * Africa's Talking SMS sender. Credentials come from the settings store (admin
 * Organization page) with env fallback. Uses the plain REST endpoint via fetch —
 * no SDK dependency. The sandbox host is used automatically when the username is
 * "sandbox".
 */
import { getEffectiveSms } from "@/lib/settings-store";

const HOST_LIVE = "https://api.africastalking.com/version1/messaging";
const HOST_SANDBOX = "https://api.sandbox.africastalking.com/version1/messaging";

export interface SmsResult {
  recipients: Array<{ number: string; status: string; messageId?: string; cost?: string }>;
}

export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const { username, apiKey, senderId } = await getEffectiveSms();
  if (!username || !apiKey) {
    throw new Error("SMS is not configured (missing Africastalking username / API key).");
  }
  const url = username.toLowerCase() === "sandbox" ? HOST_SANDBOX : HOST_LIVE;
  const form = new URLSearchParams({ username, to, message });
  if (senderId) form.set("from", senderId);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apiKey,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.errorMessage || `Africastalking error (HTTP ${res.status})`);
  }
  const data = json?.SMSMessageData;
  const recipients = data?.Recipients || [];
  if (!recipients.length) {
    // AT returns a human message here when nothing was sent (e.g. invalid number).
    throw new Error(data?.Message || "No recipients were accepted.");
  }
  const bad = recipients.find((r: any) => r.status && r.status !== "Success");
  if (bad) throw new Error(`Send failed for ${bad.number}: ${bad.status}`);
  return { recipients };
}
