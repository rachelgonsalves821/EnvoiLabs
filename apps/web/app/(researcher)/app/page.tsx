import "../../../../../docs/design-system/tokens.css";
import { researcherCopy as copy } from "./copy";
import styles from "./researcher.module.css";

function BriefFields() {
  return (
    <dl className={styles.fields}>
      {copy.fields.map(([label, description]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{description}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ResearcherPage() {
  return (
    <div className={styles.workspace}>
      <a className={styles.skip} href="#new-study">{copy.skip}</a>
      <nav className={styles.rail} aria-label={copy.navigation}>
        <span className={styles.brand}>{copy.brand}</span>
        <a href="/app" aria-current="page">{copy.studies}</a>
        <a href="/app/sign-in">{copy.signIn}</a>
      </nav>
      <main className={styles.main} id="new-study" tabIndex={-1}>
        <h1>{copy.title}</h1>
        <section className={styles.scoping} aria-labelledby="scoping-question">
          <span className={styles.echo} aria-hidden="true" />
          <div>
            <h2 id="scoping-question">{copy.question}</h2>
            <p>{copy.example}</p>
          </div>
        </section>
        <details className={styles.mobileBrief}>
          <summary>{copy.viewBrief}</summary>
          <BriefFields />
        </details>
      </main>
      <aside className={styles.brief} aria-labelledby="brief-title">
        <h2 id="brief-title">{copy.brief}</h2>
        <BriefFields />
      </aside>
    </div>
  );
}
