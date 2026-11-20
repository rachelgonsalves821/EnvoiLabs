"use client";

import { useState, type FormEvent } from "react";
import { authCopy as copy } from "../copy";
import { sendSignInLink } from "../_auth/auth-api";
import styles from "../_auth/auth.module.css";

export function SignInForm({ initialError }: Readonly<{ initialError: string }>) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(initialError);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await sendSignInLink(email.trim());
      setSent(true);
    } catch {
      setError(copy.sendFailed);
    } finally {
      setPending(false);
    }
  }

  return sent ? (
    <>
      <div role="status"><h1>{copy.checkEmail}</h1><p className={styles.hint}>{copy.checkEmailHint}</p></div>
      <button type="button" onClick={() => { setEmail(""); setSent(false); }}>{copy.changeEmail}</button>
    </>
  ) : (
    <>
      <h1>{copy.signIn}</h1>
      <p className={styles.hint}>{copy.emailHint}</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <form className={styles.form} method="post" onSubmit={submit} aria-busy={pending}>
        <label htmlFor="researcher-email">{copy.email}</label>
        <input id="researcher-email" name="email" type="email" autoComplete="email" value={email}
          onChange={(event) => setEmail(event.target.value)} required />
        <button type="submit" disabled={pending}>{pending ? copy.sending : copy.sendLink}</button>
      </form>
    </>
  );
}
