import { Inngest } from "inngest";
import { serve } from "inngest/next";
import { gate1ExpiryFunction } from "../../../inngest/platform/gate1-expiry";
import { gate1PrivateAnswersFunction } from "../../../inngest/platform/gate1-private-answers";
import { gate1InngestConfig } from "../../../server/platform/gate1-inngest-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function handlers() {
  const config = gate1InngestConfig(process.env);
  if (!config) {
    const unavailable = () => new Response(null, { status: 404 });
    return { GET: unavailable, POST: unavailable, PUT: unavailable };
  }
  const client = new Inngest({ id: "envoi-labs", ...config.client });
  const functions = [
    ...(config.expiryEnabled ? [gate1ExpiryFunction(client)] : []),
    ...(config.privateAnswersEnabled ? [gate1PrivateAnswersFunction(client)] : []),
  ];
  return serve({ client, functions });
}

export const { GET, POST, PUT } = handlers();
