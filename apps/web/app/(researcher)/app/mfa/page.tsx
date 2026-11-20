import { AuthFrame } from "../_auth/frame";
import { MfaForm } from "./mfa-form";

export default function MfaPage() {
  return <AuthFrame><MfaForm /></AuthFrame>;
}
