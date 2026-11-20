import { AuthFrame } from "../_auth/frame";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  return <AuthFrame><SignInForm expired={error === "expired"} /></AuthFrame>;
}
