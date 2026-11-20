import "@envoi-labs/ui/styles.css";
import "./respondent.css";
import { brandName } from "@envoi-labs/ui";
import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import type { ReactNode } from "react";
import { RespondentWorker } from "./respondent-worker";

export const metadata: Metadata = { manifest: "/r/manifest.webmanifest" };
export const viewport: Viewport = { viewportFit: "cover", themeColor: "#F3F2F7" };

const manrope = Manrope({ subsets: ["latin"], weight: "variable", variable: "--envoi-font-sans" });

export default function RespondentLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`respondent-shell ${manrope.variable}`} data-envoi-font="">
      <header className="respondent-topbar"><a href="/r">{brandName}</a></header>
      <main className="respondent-main">{children}</main>
      <RespondentWorker />
    </div>
  );
}
