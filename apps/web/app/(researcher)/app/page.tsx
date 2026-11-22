import "@envoi-labs/ui/styles.css";
import { requireResearcher } from "../../../server/auth/identity";
import { researcherCopy as copy } from "./copy";
import { StudyDraftForm } from "./study-draft-form";
import styles from "./researcher.module.css";

export default async function ResearcherPage() {
  await requireResearcher();

  return (
    <div className={styles.workspace}>
      <a className={styles.skip} href="#new-study">{copy.skip}</a>
      <nav className={styles.rail} aria-label={copy.navigation}>
        <span className={styles.brand}>{copy.brand}</span>
        <a href="/app" aria-current="page">{copy.title}</a>
      </nav>
      <main className={styles.main} id="new-study" tabIndex={-1}>
        <h1>{copy.title}</h1>
        <StudyDraftForm />
      </main>
    </div>
  );
}
