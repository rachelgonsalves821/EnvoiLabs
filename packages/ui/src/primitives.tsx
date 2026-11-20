import type { ComponentPropsWithRef, ComponentPropsWithoutRef, ReactNode } from "react";

type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: "primary" | "pulse" | "secondary" | "ghost";
  size?: "default" | "small";
};

export function Button({ variant = "primary", size = "default", type = "button", ...props }: ButtonProps) {
  return <button {...props} type={type} className={`ev-button ${props.className ?? ""}`} data-variant={variant} data-size={size} />;
}

type ChipProps = ComponentPropsWithoutRef<"span"> & {
  tone?: "neutral" | "good" | "warn" | "critical" | "tide" | "ink" | "outline" | "pulse";
};

export function Chip({ tone = "neutral", ...props }: ChipProps) {
  return <span {...props} className={`ev-chip ${props.className ?? ""}`} data-tone={tone} />;
}

export function EarningsChip({ amount, label = "Interview reward" }: { amount: string; label?: string }) {
  return <span className="ev-chip ev-earn"><span className="ev-sr-only">{label} </span>{amount}</span>;
}

export function ProgressTrack({ current, total }: { current: number; total: number }) {
  return (
    <div className="ev-progress">
      <span>{current} of {total}</span>
      <span className="ev-progress-track" aria-hidden="true">
        {Array.from({ length: total }, (_, index) => (
          <i key={index} data-step={index + 1 < current ? "done" : index + 1 === current ? "current" : "upcoming"} />
        ))}
      </span>
    </div>
  );
}

export function Card(props: ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={`ev-card ${props.className ?? ""}`} />;
}

type FieldProps = ComponentPropsWithoutRef<"input"> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
};

export function Field({ id, label, hint, error, ...props }: FieldProps) {
  const describedBy = [props["aria-describedby"], hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ");
  return (
    <div className="ev-field">
      <label htmlFor={id}>{label}</label>
      <input {...props} id={id} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={describedBy || undefined} />
      {hint && <span id={`${id}-hint`}>{hint}</span>}
      {error && <span id={`${id}-error`} className="ev-field-error" role="alert">{error}</span>}
    </div>
  );
}
