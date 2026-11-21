import type { Metadata } from "next";
import { signupCopy as copy } from "./copy";
import { RespondentSignup } from "./signup";
import "./signup.css";

export const metadata: Metadata = { title: copy.pageTitle };

export default async function RespondentSignupPage({ searchParams }: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  return <RespondentSignup initialError={error === "expired" ? copy.expired : ""} />;
}
