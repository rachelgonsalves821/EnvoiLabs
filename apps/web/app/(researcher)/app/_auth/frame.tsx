import type { ReactNode } from "react";
import "../../../../../../docs/design-system/tokens.css";
import { researcherCopy as copy } from "../copy";
import styles from "./auth.module.css";

export function AuthFrame({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className={styles.screen}>
      <div className={styles.panel}>
        <p className={styles.brand}>{copy.brand}</p>
        {children}
      </div>
    </main>
  );
}
