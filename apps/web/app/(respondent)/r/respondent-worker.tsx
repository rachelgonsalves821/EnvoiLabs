"use client";

import { useEffect } from "react";

export function RespondentWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      // The respondent page stays usable when the browser declines registration.
      void navigator.serviceWorker.register("/r/sw.js", { scope: "/r/" }).catch(() => undefined);
    }
  }, []);
  return null;
}
