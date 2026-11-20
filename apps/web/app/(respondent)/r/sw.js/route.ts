export function GET() {
  return new Response("self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));\n", {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
