import type { Metadata } from "next";
import { signupCopy as copy } from "./copy";
import { RespondentSignup } from "./signup";
import "./signup.css";

export const metadata: Metadata = { title: copy.pageTitle };

export default function RespondentSignupPage() {
  return <RespondentSignup />;
}
