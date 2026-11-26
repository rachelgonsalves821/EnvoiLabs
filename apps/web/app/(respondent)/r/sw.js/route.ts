const install = "self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));\n";

// The signed path is checked again when opened by the app. The worker accepts
// no URL or notification text from the push payload.
const nudge = String.raw`
const resumePath = /^\/r\/s\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\.\d{13}\.[A-Za-z0-9_-]{43}$/i;
self.addEventListener('push', (event) => {
  let payload;
  try { payload = JSON.parse(event.data?.text() ?? ''); } catch { return; }
  if (!payload || !resumePath.test(payload.path) ||
      !['halfway', 'two_hours_left'].includes(payload.kind)) return;
  const halfway = payload.kind === 'halfway';
  event.waitUntil(self.registration.showNotification(
    halfway ? 'You’re halfway through' : 'Two hours left', {
      body: halfway ? 'Continue your study where you stopped.' :
        'Finish your study before its offer expires.',
      tag: 'gate2-nudge-' + payload.kind,
      data: { path: payload.path },
    }));
});
self.addEventListener('notificationclick', (event) => {
  const path = event.notification.data?.path;
  if (!resumePath.test(path)) return;
  event.notification.close();
  event.waitUntil(self.clients.openWindow(path));
});
`;

// Proposed generic copy. The separate offer switch remains off until approved.
const matchedOffer = String.raw`
self.addEventListener('push', (event) => {
  let payload;
  try { payload = JSON.parse(event.data?.text() ?? ''); } catch { return; }
  if (!payload || payload.kind !== 'matched_offer' || payload.path !== '/r') return;
  event.waitUntil(self.registration.showNotification('New study match', {
    body: 'A study that may fit you is ready to review.',
    tag: 'gate2-matched-offer', data: { path: '/r' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  const path = event.notification.data?.path;
  if (path !== '/r') return;
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/r'));
});
`;

export function GET() {
  const script = install + (process.env.ENVOI_GATE2_PUSH_WORKER_ENABLED === "true"
    ? nudge + (process.env.ENVOI_GATE2_OFFER_PUSH_ENABLED === "true"
      ? matchedOffer : "") : "");
  return new Response(script, {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
