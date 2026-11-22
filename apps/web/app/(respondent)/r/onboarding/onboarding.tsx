"use client";

import { Button, Card, Field } from "@envoi-labs/ui";
import { ProfileResponseSchema } from "@envoi-labs/contracts";
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { consentChoices, onboardingCopy as copy, profileChoices } from "./copy";

type Step = "profile" | "consent" | "complete";
type ProfileKey = keyof typeof profileChoices | "lives_on_campus" | "region_zip" | "food_orders_per_week";
type SelectOption = readonly [value: string, label: string];
type ConsentPurpose = (typeof consentChoices)[number]["purpose"];

const profileFields = [
  ["age_range", copy.profile.ageRange, profileChoices.age_range],
  ["gender", copy.profile.gender, profileChoices.gender],
  ["student_year", copy.profile.studentYear, profileChoices.student_year],
  ["lives_on_campus", copy.profile.campus, [["true", "Yes"], ["false", "No"]]],
  ["online_shopping_frequency", copy.profile.shopping, profileChoices.online_shopping_frequency],
] as const satisfies ReadonlyArray<readonly [ProfileKey, string, readonly SelectOption[]]>;

function readProfile(formData: FormData) {
  const selectedFields = profileFields.map(([key, , options]) => {
    const value = formData.get(key);
    return typeof value === "string" && options.some(([option]) => option === value) ? { key, value } : null;
  });
  const zip = formData.get("region_zip");
  const orders = formData.get("food_orders_per_week");
  const interests = formData.getAll("interests").filter((value): value is string =>
    typeof value === "string" && profileChoices.interests.some(([option]) => option === value),
  );
  if (selectedFields.some((field) => field === null) || typeof zip !== "string" || !/^\d{5}$/.test(zip)
    || typeof orders !== "string" || !/^(0|[1-9]\d?)$/.test(orders) || interests.length < 2 || interests.length > 3) {
    return null;
  }
  return {
    attributes: [
      ...selectedFields.flatMap((field) =>
        field ? [{ key: field.key, value: field.key === "lives_on_campus" ? field.value === "true" : field.value }] : [],
      ),
      { key: "region_zip", value: zip },
      { key: "food_orders_per_week", value: Number(orders) },
      { key: "interests", value: interests },
    ],
  };
}

function fieldValue(key: ProfileKey, attributes: Record<string, unknown>) {
  const value = attributes[key];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (key === "student_year" && attributes.student === false) return "not_student";
  if (key === "age_range" && typeof attributes.age === "number") {
    const age = attributes.age;
    return profileChoices.age_range.find(([band]) => {
      const [lower, upper] = band.replace("+", "").split("-").map(Number);
      return lower !== undefined && age >= lower && (upper === undefined || age <= upper);
    })?.[0] ?? "";
  }
  return "";
}

export function Onboarding({ attributes, choices, consentVersion }: {
  attributes: Record<string, unknown>;
  choices: Partial<Record<ConsentPurpose, boolean>>;
  consentVersion: string;
}) {
  const completedProfile = [...profileFields.map(([key]) => key), "region_zip", "food_orders_per_week", "interests"]
    .every((key) => Object.hasOwn(attributes, key));
  const [consentSaved, setConsentSaved] = useState(consentChoices.every(({ purpose }) => typeof choices[purpose] === "boolean"));
  const [profile, setProfile] = useState(attributes);
  const [selectedInterests, setSelectedInterests] = useState<string[]>(
    Array.isArray(attributes.interests) ? attributes.interests.filter((item): item is string => typeof item === "string") : [],
  );
  const [selectedConsent, setSelectedConsent] = useState(choices);
  const [step, setStep] = useState<Step>(completedProfile ? (consentSaved ? "complete" : "consent") : "profile");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);

  useEffect(() => {
    if (previousStep.current !== step) heading.current?.focus();
    previousStep.current = step;
  }, [step]);

  function changeStep(next: Step) {
    setError("");
    setStep(next);
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const isProfile = step === "profile";
    const payload = isProfile ? readProfile(new FormData(event.currentTarget)) : {
      studyId: null,
      decisions: consentChoices.map(({ purpose }) => ({
        purpose, granted: selectedConsent[purpose] ?? false, textVersion: consentVersion,
      })),
    };
    if (!payload) {
      setError(copy.profile.invalid);
      return;
    }
    sending.current = true;
    setPending(true);
    setError("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(isProfile ? "/api/respondent/profile" : "/api/respondent/consent", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        redirect: "error", cache: "no-store", signal: controller.signal,
      });
      if (response.status === 401) {
        setError(copy.signInAgain);
        return;
      }
      if (!response.ok) throw new Error();
      const result: unknown = await response.json();
      if (isProfile) {
        const saved = ProfileResponseSchema.parse(result);
        setProfile(Object.fromEntries(saved.attributes.map(({ key, value }) => [key, value])));
        changeStep(consentSaved ? "complete" : "consent");
      } else {
        if (!result || typeof result !== "object" || !("ok" in result) || result.ok !== true) throw new Error();
        setConsentSaved(true);
        changeStep("complete");
      }
    } catch {
      setError(copy.saveFailed);
    } finally {
      clearTimeout(timeout);
      sending.current = false;
      setPending(false);
    }
  }

  const content = copy[step];
  return (
    <Card className="respondent-welcome respondent-onboarding">
      <div>
        <h1 ref={heading} tabIndex={-1}>{content.heading}</h1>
        <p>{content.introduction}</p>
      </div>
      {step === "profile" && (
        <form onSubmit={(event) => void save(event)} className="respondent-onboarding-form">
          {profileFields.map(([key, label, options]) => (
            <div className="ev-field" key={key}>
              <label htmlFor={key}>{label}</label>
              <select id={key} name={key} defaultValue={fieldValue(key, profile)} disabled={pending} required>
                <option value="">{copy.profile.select}</option>
                {options.map(([value, title]) => <option value={value} key={value}>{title}</option>)}
              </select>
            </div>
          ))}
          <Field id="region_zip" name="region_zip" label={copy.profile.zip} inputMode="numeric"
            autoComplete="postal-code" pattern="[0-9]{5}" maxLength={5} defaultValue={fieldValue("region_zip", profile)}
            readOnly={pending} required />
          <Field id="food_orders_per_week" name="food_orders_per_week" label={copy.profile.foodOrders}
            type="number" inputMode="numeric" min={0} max={99} step={1} defaultValue={fieldValue("food_orders_per_week", profile)}
            readOnly={pending} required />
          <fieldset className="respondent-onboarding-choices">
            <legend>{copy.profile.interests}</legend>
            <p>{copy.profile.interestHint}</p>
            {profileChoices.interests.map(([value, title]) => (
              <label key={value}>
                <input type="checkbox" name="interests" value={value} checked={selectedInterests.includes(value)}
                  disabled={pending || (!selectedInterests.includes(value) && selectedInterests.length >= 3)}
                  onChange={(event) => setSelectedInterests(event.currentTarget.checked
                    ? [...selectedInterests, value]
                    : selectedInterests.filter((interest) => interest !== value))} />
                {title}
              </label>
            ))}
          </fieldset>
          <Button type="submit" variant="pulse" aria-disabled={pending}>{copy.profile.submit}</Button>
        </form>
      )}
      {step === "consent" && (
        <form onSubmit={(event) => void save(event)} className="respondent-onboarding-form">
          <div className="respondent-onboarding-choices">
            {consentChoices.map(({ purpose, title, details }) => (
              <label key={purpose}>
                <input type="checkbox" checked={selectedConsent[purpose] ?? false} disabled={pending}
                  onChange={(event) => setSelectedConsent({ ...selectedConsent, [purpose]: event.currentTarget.checked })} />
                <span>{title}<small>{details}</small></span>
              </label>
            ))}
          </div>
          <details>
            <summary>{copy.consent.details}</summary>
            <p>{copy.consent.detailsText}</p>
            <p>{copy.consent.version}</p>
          </details>
          <Button type="submit" variant="pulse" aria-disabled={pending}>{copy.consent.submit}</Button>
          <Button variant="ghost" aria-disabled={pending} onClick={() => !sending.current && changeStep("profile")}>
            {copy.consent.back}
          </Button>
        </form>
      )}
      {step === "complete" && (
        <div className="respondent-onboarding-form">
          <Button variant="secondary" onClick={() => changeStep("profile")}>{copy.complete.profile}</Button>
          <Button variant="ghost" onClick={() => changeStep("consent")}>{copy.complete.consent}</Button>
          <a className="ev-button respondent-signup-link" href="/r/status">{copy.complete.home}</a>
        </div>
      )}
      {pending && <p role="status">{copy.saving}</p>}
      {error && <p className="respondent-onboarding-error" role="alert">{error}</p>}
    </Card>
  );
}
