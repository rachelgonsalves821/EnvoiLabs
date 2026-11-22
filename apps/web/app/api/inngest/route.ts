import { Inngest } from "inngest";
import { serve } from "inngest/next";
import { gate1ExpiryFunction } from "../../../inngest/platform/gate1-expiry";
import { expirySchedulerConfig } from "../../../server/platform/gate1-expiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handlers() {
  const config = expirySchedulerConfig(process.env);
  if (!config) {
    const unavailable = () => new Response(null, { status: 404 });
    return { GET: unavailable, POST: unavailable, PUT: unavailable };
  }
  const client = new Inngest({ id: "envoi-labs", ...config });
  return serve({ client, functions: [gate1ExpiryFunction(client)] });
}

export const { GET, POST, PUT } = handlers();
