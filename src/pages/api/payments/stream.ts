import type { NextApiRequest, NextApiResponse } from "next";
import { applyCors } from "@/lib/http";
import { verifySession } from "@/lib/jwt";
import { findTxnByCheckoutId, type TxnRow } from "@/lib/txn-store";
import { advanceTxnViaQuery, isTerminal } from "@/lib/payments";

/**
 * Server-Sent Events stream for one STK push. The browser opens this with an
 * EventSource and we push a `status` event each time we learn more — first
 * immediately, then on a server-side tick that reads the (callback-updated)
 * transaction row and nudges Daraja directly as a fallback. We close the stream
 * on a terminal status or after a hard timeout.
 *
 * EventSource can't send an Authorization header, so the JWT arrives as a
 * `token` query param (this is a read-only, same-customer status feed).
 */
export const config = { api: { bodyParser: false } };

const TICK_MS = 3000;
const MAX_MS = 100000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: `Method ${req.method} not allowed` });
    return;
  }

  // Authenticate + authorise before opening the stream, so failures are plain JSON.
  let email: string;
  try {
    email = verifySession(String(req.query.token || "")).email;
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  const checkoutRequestId = String(req.query.checkoutRequestId || "").trim();
  if (!checkoutRequestId) {
    res.status(400).json({ error: "checkoutRequestId is required" });
    return;
  }

  const found = await findTxnByCheckoutId(checkoutRequestId);
  if (!found) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  if ((found.email || "").toLowerCase() !== email.toLowerCase()) {
    res.status(403).json({ error: "Not your transaction" });
    return;
  }
  let txn: TxnRow = found;

  // Open the event stream. No throwing past this point — headers are committed.
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable proxy buffering (nginx et al.)
  });
  res.flushHeaders?.();

  let closed = false;
  const send = (event: string, data: unknown) => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const payload = (t: TxnRow) => ({
    status: t.status,
    resultDesc: t.result_desc,
    mpesaReceipt: t.mpesa_receipt,
    amount: t.amount,
  });

  // Emit the current state right away.
  send("status", payload(txn));

  const started = Date.now();
  const timer = setInterval(async () => {
    if (closed) return;
    try {
      const fresh = (await findTxnByCheckoutId(checkoutRequestId)) || txn;
      txn = isTerminal(fresh.status) ? fresh : await advanceTxnViaQuery(fresh);
      send("status", payload(txn));
      if (isTerminal(txn.status)) return end();
    } catch {
      /* transient read/query error — keep the stream alive and retry next tick */
    }
    if (Date.now() - started > MAX_MS) {
      send("timeout", { status: txn.status });
      end();
    }
  }, TICK_MS);

  const end = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    try {
      res.end();
    } catch {
      /* already torn down */
    }
  };
  req.on("close", end);

  // Already resolved before the first tick — report and close immediately.
  if (isTerminal(txn.status)) end();
}
