import { observePreviewIngress } from "../../../../server/gate4/ingress-observer";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  return observePreviewIngress(request, process.env);
}
