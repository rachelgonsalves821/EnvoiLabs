import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckoutDatabase, CheckoutSession } from "@envoi-labs/services/checkout";
import { MarketplaceFeasibilitySchema } from "@envoi-labs/contracts";
import type { Database } from "../../../../packages/db/src/database.generated";

type Researcher = { id: string; organizationId: string; authUserId: string };
type Tables = Database["public"]["Tables"];
type StudyRow = Tables["studies"]["Row"];
type BriefRow = Tables["brief_versions"]["Row"];
type GuideRow = Tables["guide_questions"]["Row"];
type OrganizationRow = Tables["organizations"]["Row"];
type PricingRow = Tables["pricing_configs"]["Row"];
type QuoteRow = Tables["gate2_quote_snapshots"]["Row"];
type PaymentEventRow = Tables["gate2_payment_events"]["Row"];

export function mapGate2Quote(row: QuoteRow) {
  return { id: row.id, studyId: row.study_id, briefVersion: row.brief_version,
    guideDigest: row.guide_digest, pricingConfigId: row.pricing_config_id,
    pricingConfigVersion: row.pricing_config_version, currency: row.currency,
    totalCents: row.total_cents, incentiveCentsPerComplete: row.incentive_cents_per_complete,
    lineItems: row.line_items_json, feasibility: row.feasibility_json,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.created_at).toISOString() };
}

function readData<T>(result: { data: T | null; error: unknown }): T | null {
  if (result.error) throw result.error;
  return result.data;
}

export function createGate2CheckoutDatabase(
  client: SupabaseClient<Database>, researcher: Researcher,
): CheckoutDatabase {
  const allowedStudy = async (studyId: string) => {
    const membership = readData(await client.from("researchers")
      .select("*").eq("id", researcher.id).eq("organization_id", researcher.organizationId)
      .eq("auth_user_id", researcher.authUserId)
      .maybeSingle());
    if (!membership) return null;
    return readData(await client.from("studies")
      .select("*").eq("id", studyId)
      .eq("organization_id", researcher.organizationId).maybeSingle()) as StudyRow | null;
  };
  return {
    async readApprovedScope(studyId) {
      const study = await allowedStudy(studyId);
      if (!study || !["brief_ready", "awaiting_payment"].includes(study.state) ||
        !study.deadline_at || Date.parse(study.deadline_at) <= Date.now()) return null;
      const brief = readData(await client.from("brief_versions")
        .select("*").eq("study_id", studyId)
        .order("version", { ascending: false }).limit(1).maybeSingle()) as BriefRow | null;
      const questions = readData(await client.from("guide_questions")
        .select("*").eq("study_id", studyId)) as GuideRow[] | null;
      if (!brief || !questions || questions.length < 4 || questions.length > 10) return null;
      const feasibility = MarketplaceFeasibilitySchema.safeParse(readData(await client.rpc(
        "read_gate2_marketplace_feasibility", {
          supplied_study_id: studyId, supplied_auth_user_id: researcher.authUserId,
        })));
      if (!feasibility.success || feasibility.data.studyId !== studyId) return null;
      return { studyId, briefVersion: brief.version, coreQuestionCount: questions.length,
        targetRespondents: study.target_completes, feasibility: feasibility.data };
    },
    async readSelectedPricing(studyId) {
      const study = await allowedStudy(studyId);
      if (!study) return null;
      const organization = readData(await client.from("organizations")
        .select("*").eq("id", researcher.organizationId).maybeSingle()) as OrganizationRow | null;
      if (!organization) return null;
      const selected = organization.pricing_override_id
        ? await client.from("pricing_configs").select("*")
          .eq("id", organization.pricing_override_id).maybeSingle()
        : await client.from("pricing_configs").select("*")
          .eq("marketplace_active", true).maybeSingle();
      const config = readData(selected) as PricingRow | null;
      if (!config || typeof config.params_json !== "object" || !config.params_json) return null;
      const params = config.params_json as Record<string, unknown>;
      if (!Number.isSafeInteger(params.unitPriceCents) || !Number.isSafeInteger(params.incentivePerQuestionCents))
        return null;
      return { id: config.id, version: config.version,
        unitPriceCents: params.unitPriceCents as number,
        incentivePerQuestionCents: params.incentivePerQuestionCents as number };
    },
    async freezeQuote(input) {
      if (!await allowedStudy(input.studyId)) throw new Error("Study outside researcher organization");
      const id = readData(await client.rpc("freeze_gate2_marketplace_quote", {
        supplied_study_id: input.studyId, supplied_brief_version: input.briefVersion,
        supplied_config_id: input.pricingConfigId,
        supplied_config_version: input.pricingConfigVersion,
        supplied_line_items: input.lineItems, supplied_total_cents: input.totalCents,
        supplied_incentive_cents: input.incentiveCentsPerComplete,
        supplied_auth_user_id: researcher.authUserId,
      }));
      if (!id) throw new Error("Quote freeze returned no identity");
      return id;
    },
    async readQuote(studyId, quoteId) {
      if (!await allowedStudy(studyId)) return null;
      const row = readData(await client.from("gate2_quote_snapshots").select("*")
        .eq("study_id", studyId).eq("id", quoteId).maybeSingle()) as QuoteRow | null;
      if (!row) return null;
      return mapGate2Quote(row);
    },
    async claimCheckoutIntent(studyId, quoteId) {
      if (!await allowedStudy(studyId)) return { status: "blocked" };
      const result = readData(await client.rpc("claim_gate2_checkout_intent", {
        supplied_study_id: studyId, supplied_quote_id: quoteId,
      }));
      if (!result || typeof result !== "object" || Array.isArray(result))
        return { status: "unavailable" };
      const value = result as Record<string, unknown>;
      if (value.status === "create" && value.key === `gate2-checkout:${quoteId}`)
        return { status: "create", key: value.key };
      if (value.status === "known" && typeof value.checkoutId === "string" &&
        value.checkoutId.startsWith("cs_test_"))
        return { status: "known", checkoutId: value.checkoutId };
      if (value.status === "blocked") return { status: "blocked" };
      return { status: "unavailable" };
    },
    async recordCheckoutCreated(session: CheckoutSession, eventId, observedAt) {
      const quote = readData(await client.from("gate2_quote_snapshots").select("*")
        .eq("id", session.quoteId).eq("study_id", session.studyId).maybeSingle()) as QuoteRow | null;
      if (!quote || !await allowedStudy(session.studyId) ||
        quote.total_cents !== session.amountCents ||
        quote.pricing_config_version !== session.pricingConfigVersion ||
        quote.currency !== session.currency) throw new Error("Checkout outside frozen quote scope");
      const { error } = await client.from("gate2_payment_events").insert({
        quote_id: session.quoteId, study_id: session.studyId,
        provider_checkout_id: session.id, provider_event_id: eventId,
        event_kind: "checkout_created", amount_cents: session.amountCents,
        currency: session.currency, provider_observed_at: observedAt,
      });
      if (!error) return;
      if (error.code !== "23505") throw error;
      const existing = readData(await client.from("gate2_payment_events")
        .select("*")
        .eq("quote_id", session.quoteId).eq("event_kind", "checkout_created")
        .maybeSingle()) as PaymentEventRow | null;
      if (!existing || existing.provider_checkout_id !== session.id ||
        existing.provider_event_id !== eventId || existing.amount_cents !== session.amountCents ||
        existing.currency !== session.currency || existing.study_id !== session.studyId) throw error;
    },
  };
}
