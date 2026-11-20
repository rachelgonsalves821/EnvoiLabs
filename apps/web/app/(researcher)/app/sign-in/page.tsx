import { AuthFrame } from "../_auth/frame";
import { authCopy } from "../copy";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const messages = { expired: authCopy.expiredLink, session: authCopy.expiredSession };
  const initialError = error === "expired" || error === "session" ? messages[error] : "";
  return <AuthFrame><SignInForm initialError={initialError} /></AuthFrame>;
}
