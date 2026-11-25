import type { Metadata } from "next";
import { AuthFrame } from "../_auth/frame";
import { authCopy } from "../copy";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: `${authCopy.mfa} | Envoi Labs` };

export default function MfaPage() {
  return <AuthFrame><MfaForm /></AuthFrame>;
}
