export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      answers: {
        Row: {
          audio_object_id: string | null
          created_at: string
          duration_ms: number | null
          guide_question_id: string
          id: string
          kind: string
          probe_id: string | null
          sequence: number
          session_id: string
          study_id: string
          updated_at: string
        }
        Insert: {
          audio_object_id?: string | null
          created_at?: string
          duration_ms?: number | null
          guide_question_id: string
          id?: string
          kind: string
          probe_id?: string | null
          sequence: number
          session_id: string
          study_id: string
          updated_at?: string
        }
        Update: {
          audio_object_id?: string | null
          created_at?: string
          duration_ms?: number | null
          guide_question_id?: string
          id?: string
          kind?: string
          probe_id?: string | null
          sequence?: number
          session_id?: string
          study_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "answers_guide_question_id_study_id_fkey"
            columns: ["guide_question_id", "study_id"]
            isOneToOne: false
            referencedRelation: "guide_questions"
            referencedColumns: ["id", "study_id"]
          },
          {
            foreignKeyName: "answers_probe_in_session_question"
            columns: ["probe_id", "session_id", "guide_question_id"]
            isOneToOne: false
            referencedRelation: "probes"
            referencedColumns: ["id", "session_id", "guide_question_id"]
          },
          {
            foreignKeyName: "answers_session_id_study_id_fkey"
            columns: ["session_id", "study_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "study_id"]
          },
        ]
      }
      audit_log: {
        Row: {
          actor: string
          at: string
          created_at: string
          entity: string
          entity_id: string
          from_state: string | null
          id: string
          meta: Json
          to_state: string
          updated_at: string
        }
        Insert: {
          actor: string
          at?: string
          created_at?: string
          entity: string
          entity_id: string
          from_state?: string | null
          id?: string
          meta?: Json
          to_state: string
          updated_at?: string
        }
        Update: {
          actor?: string
          at?: string
          created_at?: string
          entity?: string
          entity_id?: string
          from_state?: string | null
          id?: string
          meta?: Json
          to_state?: string
          updated_at?: string
        }
        Relationships: []
      }
      brief_versions: {
        Row: {
          brief_json: Json
          created_at: string
          created_by: string
          id: string
          study_id: string
          updated_at: string
          version: number
        }
        Insert: {
          brief_json: Json
          created_at?: string
          created_by: string
          id?: string
          study_id: string
          updated_at?: string
          version: number
        }
        Update: {
          brief_json?: Json
          created_at?: string
          created_by?: string
          id?: string
          study_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "brief_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "researchers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_versions_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          created_at: string
          granted: boolean
          id: string
          purpose: string
          recorded_sequence: number
          respondent_id: string
          study_id: string | null
          text_version: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          granted: boolean
          id?: string
          purpose: string
          recorded_sequence?: never
          respondent_id: string
          study_id?: string | null
          text_version: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          granted?: boolean
          id?: string
          purpose?: string
          recorded_sequence?: never
          respondent_id?: string
          study_id?: string | null
          text_version?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consents_respondent_id_fkey"
            columns: ["respondent_id"]
            isOneToOne: false
            referencedRelation: "respondents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      criteria: {
        Row: {
          attribute_key: string
          created_at: string
          id: string
          kind: string
          operator: string
          study_id: string
          text: string
          updated_at: string
          value_json: Json
        }
        Insert: {
          attribute_key: string
          created_at?: string
          id?: string
          kind: string
          operator: string
          study_id: string
          text: string
          updated_at?: string
          value_json: Json
        }
        Update: {
          attribute_key?: string
          created_at?: string
          id?: string
          kind?: string
          operator?: string
          study_id?: string
          text?: string
          updated_at?: string
          value_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "criteria_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          actor_hash: string | null
          actor_type: string
          created_at: string
          id: string
          name: string
          occurred_at: string
          props: Json
          study_id: string | null
          updated_at: string
        }
        Insert: {
          actor_hash?: string | null
          actor_type: string
          created_at?: string
          id?: string
          name: string
          occurred_at?: string
          props?: Json
          study_id?: string | null
          updated_at?: string
        }
        Update: {
          actor_hash?: string | null
          actor_type?: string
          created_at?: string
          id?: string
          name?: string
          occurred_at?: string
          props?: Json
          study_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_quotes: {
        Row: {
          created_at: string
          end_char: number
          finding_id: string
          id: string
          source_version: string | null
          start_char: number
          study_id: string
          text: string
          transcript_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_char: number
          finding_id: string
          id?: string
          source_version?: string | null
          start_char: number
          study_id: string
          text: string
          transcript_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_char?: number
          finding_id?: string
          id?: string
          source_version?: string | null
          start_char?: number
          study_id?: string
          text?: string
          transcript_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_quotes_finding_id_study_id_fkey"
            columns: ["finding_id", "study_id"]
            isOneToOne: false
            referencedRelation: "findings"
            referencedColumns: ["id", "study_id"]
          },
          {
            foreignKeyName: "evidence_quotes_transcript_id_study_id_fkey"
            columns: ["transcript_id", "study_id"]
            isOneToOne: false
            referencedRelation: "transcripts"
            referencedColumns: ["id", "study_id"]
          },
        ]
      }
      findings: {
        Row: {
          claim: string
          confidence: string
          count: number
          created_at: string
          id: string
          position: number
          qualified_claim: string | null
          report_id: string
          study_id: string
          total: number
          updated_at: string
        }
        Insert: {
          claim: string
          confidence: string
          count: number
          created_at?: string
          id?: string
          position: number
          qualified_claim?: string | null
          report_id: string
          study_id: string
          total: number
          updated_at?: string
        }
        Update: {
          claim?: string
          confidence?: string
          count?: number
          created_at?: string
          id?: string
          position?: number
          qualified_claim?: string | null
          report_id?: string
          study_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "findings_report_id_study_id_fkey"
            columns: ["report_id", "study_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id", "study_id"]
          },
        ]
      }
      gate2_payment_events: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          event_kind: string
          id: string
          provider_checkout_id: string
          provider_event_id: string
          provider_observed_at: string
          quote_id: string
          study_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency: string
          event_kind: string
          id?: string
          provider_checkout_id: string
          provider_event_id: string
          provider_observed_at: string
          quote_id: string
          study_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          event_kind?: string
          id?: string
          provider_checkout_id?: string
          provider_event_id?: string
          provider_observed_at?: string
          quote_id?: string
          study_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gate2_payment_events_quote_id_study_id_fkey"
            columns: ["quote_id", "study_id"]
            isOneToOne: false
            referencedRelation: "gate2_quote_snapshots"
            referencedColumns: ["id", "study_id"]
          },
        ]
      }
      gate2_payout_events: {
        Row: {
          amount_cents: number
          created_at: string
          event_kind: string
          id: string
          payout_id: string
          provider_event_id: string
          provider_observed_at: string
          provider_order_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          event_kind: string
          id?: string
          payout_id: string
          provider_event_id: string
          provider_observed_at: string
          provider_order_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          event_kind?: string
          id?: string
          payout_id?: string
          provider_event_id?: string
          provider_observed_at?: string
          provider_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gate2_payout_events_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      gate2_quote_snapshots: {
        Row: {
          brief_version: number
          created_at: string
          currency: string
          feasibility_json: Json
          guide_digest: string
          id: string
          incentive_cents_per_complete: number
          line_items_json: Json
          pricing_config_id: string
          pricing_config_version: number
          study_id: string
          total_cents: number
        }
        Insert: {
          brief_version: number
          created_at?: string
          currency?: string
          feasibility_json: Json
          guide_digest: string
          id?: string
          incentive_cents_per_complete: number
          line_items_json: Json
          pricing_config_id: string
          pricing_config_version: number
          study_id: string
          total_cents: number
        }
        Update: {
          brief_version?: number
          created_at?: string
          currency?: string
          feasibility_json?: Json
          guide_digest?: string
          id?: string
          incentive_cents_per_complete?: number
          line_items_json?: Json
          pricing_config_id?: string
          pricing_config_version?: number
          study_id?: string
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "gate2_quote_snapshots_pricing_config_id_pricing_config_ver_fkey"
            columns: ["pricing_config_id", "pricing_config_version"]
            isOneToOne: false
            referencedRelation: "pricing_configs"
            referencedColumns: ["id", "version"]
          },
          {
            foreignKeyName: "gate2_quote_snapshots_study_id_brief_version_fkey"
            columns: ["study_id", "brief_version"]
            isOneToOne: false
            referencedRelation: "brief_versions"
            referencedColumns: ["study_id", "version"]
          },
          {
            foreignKeyName: "gate2_quote_snapshots_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      gate2_referral_profile_verifications: {
        Row: {
          id: string
          normalized_email_hash: string
          profile_digest: string
          referee_id: string
          referral_id: string
          referrer_id: string
          verified_at: string
        }
        Insert: {
          id?: string
          normalized_email_hash: string
          profile_digest: string
          referee_id: string
          referral_id: string
          referrer_id: string
          verified_at?: string
        }
        Update: {
          id?: string
          normalized_email_hash?: string
          profile_digest?: string
          referee_id?: string
          referral_id?: string
          referrer_id?: string
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gate2_referral_profile_verifications_referee_id_fkey"
            columns: ["referee_id"]
            isOneToOne: true
            referencedRelation: "respondents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate2_referral_profile_verifications_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: true
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate2_referral_profile_verifications_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "respondents"
            referencedColumns: ["id"]
          },
        ]
      }
      gate2_referral_vestings: {
        Row: {
          bonus_cents: number
          id: string
          idempotency_key: string
          referrer_id: string
          verified_profile_count: number
          vested_at: string
        }
        Insert: {
          bonus_cents: number
          id?: string
          idempotency_key: string
          referrer_id: string
          verified_profile_count: number
          vested_at?: string
        }
        Update: {
          bonus_cents?: number
          id?: string
          idempotency_key?: string
          referrer_id?: string
          verified_profile_count?: number
          vested_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gate2_referral_vestings_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: true
            referencedRelation: "respondents"
            referencedColumns: ["id"]
          },
        ]
      }
      gate2_refund_reservations: {
        Row: {
          amount_cents: number
          created_at: string
          fulfilled_slots: number
          id: string
          idempotency_key: string
          purchased_slots: number
          quote_id: string
          slot_price_cents: number
          study_id: string
          unfilled_slots: number
        }
        Insert: {
          amount_cents: number
          created_at?: string
          fulfilled_slots: number
          id?: string
          idempotency_key: string
          purchased_slots: number
          quote_id: string
          slot_price_cents: number
          study_id: string
          unfilled_slots: number
        }
        Update: {
          amount_cents?: number
          created_at?: string
          fulfilled_slots?: number
          id?: string
          idempotency_key?: string
          purchased_slots?: number
          quote_id?: string
          slot_price_cents?: number
          study_id?: string
          unfilled_slots?: number
        }
        Relationships: [
          {
            foreignKeyName: "gate2_refund_reservations_quote_id_study_id_fkey"
            columns: ["quote_id", "study_id"]
            isOneToOne: false
            referencedRelation: "gate2_quote_snapshots"
            referencedColumns: ["id", "study_id"]
          },
        ]
      }
      gate2_screening_events: {
        Row: {
          action: string
          answer_id: string
          confirmed_fact: boolean | null
          created_at: string
          end_char: number | null
          id: string
          interpretation: string | null
          rule_id: string
          rule_version: number
          start_char: number | null
        }
        Insert: {
          action: string
          answer_id: string
          confirmed_fact?: boolean | null
          created_at?: string
          end_char?: number | null
          id?: string
          interpretation?: string | null
          rule_id: string
          rule_version: number
          start_char?: number | null
        }
        Update: {
          action?: string
          answer_id?: string
          confirmed_fact?: boolean | null
          created_at?: string
          end_char?: number | null
          id?: string
          interpretation?: string | null
          rule_id?: string
          rule_version?: number
          start_char?: number | null
        }
        Relationships: []
      }
      gate2_screening_rules: {
        Row: {
          approved_at: string
          approved_by: string
          created_at: string
          criterion_id: string
          criterion_kind: string
          criterion_text: string
          id: string
          question: string
          study_id: string
          timeframe_text: string
          version: number
        }
        Insert: {
          approved_at: string
          approved_by: string
          created_at?: string
          criterion_id: string
          criterion_kind: string
          criterion_text: string
          id?: string
          question: string
          study_id: string
          timeframe_text: string
          version: number
        }
        Update: {
          approved_at?: string
          approved_by?: string
          created_at?: string
          criterion_id?: string
          criterion_kind?: string
          criterion_text?: string
          id?: string
          question?: string
          study_id?: string
          timeframe_text?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "gate2_screening_rules_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "researchers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate2_screening_rules_criterion_id_study_id_fkey"
            columns: ["criterion_id", "study_id"]
            isOneToOne: false
            referencedRelation: "criteria"
            referencedColumns: ["id", "study_id"]
          },
        ]
      }
      guide_questions: {
        Row: {
          created_at: string
          id: string
          max_probes: number
          position: number
          study_id: string
          text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_probes?: number
          position: number
          study_id: string
          text: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          max_probes?: number
          position?: number
          study_id?: string
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guide_questions_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          respondent_id: string
          reward_cents: number
          state: string
          study_id: string
          updated_at: string
          why_you_text: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          respondent_id: string
          reward_cents: number
          state?: string
          study_id: string
          updated_at?: string
          why_you_text?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          respondent_id?: string
          reward_cents?: number
          state?: string
          study_id?: string
          updated_at?: string
          why_you_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invites_respondent_id_fkey"
            columns: ["respondent_id"]
            isOneToOne: false
            referencedRelation: "respondents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_calls: {
        Row: {
          cost_micros: number
          created_at: string
          id: string
          input_tokens: number
          latency_ms: number
          model: string
          ok: boolean
          output_tokens: number
          purpose: string
          study_id: string | null
          updated_at: string
        }
        Insert: {
          cost_micros: number
          created_at?: string
          id?: string
          input_tokens: number
          latency_ms: number
          model: string
          ok: boolean
          output_tokens: number
          purpose: string
          study_id?: string | null
          updated_at?: string
        }
        Update: {
          cost_micros?: number
          created_at?: string
          id?: string
          input_tokens?: number
          latency_ms?: number
          model?: string
          ok?: boolean
          output_tokens?: number
          purpose?: string
          study_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "llm_calls_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          design_partner: boolean
          id: string
          name: string
          pricing_override_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          design_partner?: boolean
          id?: string
          name: string
          pricing_override_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          design_partner?: boolean
          id?: string
          name?: string
          pricing_override_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_pricing_override_id_fkey"
            columns: ["pricing_override_id"]
            isOneToOne: false
            referencedRelation: "pricing_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          refunded_cents: number
          status: string
          stripe_checkout_id: string
          study_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          refunded_cents?: number
          status: string
          stripe_checkout_id: string
          study_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          refunded_cents?: number
          status?: string
          stripe_checkout_id?: string
          study_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount_cents: number
          bonus_ref: string | null
          created_at: string
          id: string
          idempotency_key: string
          respondent_id: string
          session_id: string | null
          state: string
          tremendous_order_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          bonus_ref?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          respondent_id: string
          session_id?: string | null
          state?: string
          tremendous_order_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          bonus_ref?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          respondent_id?: string
          session_id?: string | null
          state?: string
          tremendous_order_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_respondent_id_fkey"
            columns: ["respondent_id"]
            isOneToOne: false
            referencedRelation: "respondents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      points_entries: {
        Row: {
          created_at: string
          delta: number
          id: string
          reason: string
          ref_id: string
          respondent_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          delta: number
          id?: string
          reason: string
          ref_id: string
          respondent_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          delta?: number
          id?: string
          reason?: string
          ref_id?: string
          respondent_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "points_entries_respondent_id_fkey"
            columns: ["respondent_id"]
            isOneToOne: false
            referencedRelation: "respondents"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_configs: {
        Row: {
          active: boolean
          created_at: string
          id: string
          marketplace_active: boolean
          params_json: Json
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          marketplace_active?: boolean
          params_json: Json
          updated_at?: string
          version: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          marketplace_active?: boolean
          params_json?: Json
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      probes: {
        Row: {
          answer_id: string
          created_at: string
          decided_at: string
          guide_question_id: string
          id: string
          latency_ms: number | null
          session_id: string
          shown_at: string | null
          text: string
          updated_at: string
        }
        Insert: {
          answer_id: string
          created_at?: string
          decided_at: string
          guide_question_id: string
          id?: string
          latency_ms?: number | null
          session_id: string
          shown_at?: string | null
          text: string
          updated_at?: string
        }
        Update: {
          answer_id?: string
          created_at?: string
          decided_at?: string
          guide_question_id?: string
          id?: string
          latency_ms?: number | null
          session_id?: string
          shown_at?: string | null
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "probes_answer_id_session_id_guide_question_id_fkey"
            columns: ["answer_id", "session_id", "guide_question_id"]
            isOneToOne: false
            referencedRelation: "answers"
            referencedColumns: ["id", "session_id", "guide_question_id"]
          },
        ]
      }
      profile_attributes: {
        Row: {
          created_at: string
          id: string
          key: string
          respondent_id: string
          source: string
          updated_at: string
          value_json: Json
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          respondent_id: string
          source: string
          updated_at?: string
          value_json: Json
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          respondent_id?: string
          source?: string
          updated_at?: string
          value_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "profile_attributes_respondent_id_fkey"
            columns: ["respondent_id"]
            isOneToOne: false
            referencedRelation: "respondents"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          keys_json: Json
          platform: string
          respondent_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          keys_json: Json
          platform: string
          respondent_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          keys_json?: Json
          platform?: string
          respondent_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_respondent_id_fkey"
            columns: ["respondent_id"]
            isOneToOne: false
            referencedRelation: "respondents"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_scores: {
        Row: {
          components_json: Json
          created_at: string
          decided_by: string | null
          decision: string
          id: string
          score: number
          session_id: string
          updated_at: string
        }
        Insert: {
          components_json: Json
          created_at?: string
          decided_by?: string | null
          decision: string
          id?: string
          score: number
          session_id: string
          updated_at?: string
        }
        Update: {
          components_json?: Json
          created_at?: string
          decided_by?: string | null
          decision?: string
          id?: string
          score?: number
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quality_scores_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "researchers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_scores_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          created_at: string
          feasibility_json: Json
          id: string
          incentive_cents_per_complete: number
          line_items_json: Json
          pricing_config_version: number
          study_id: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          feasibility_json: Json
          id?: string
          incentive_cents_per_complete: number
          line_items_json: Json
          pricing_config_version: number
          study_id: string
          total_cents: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          feasibility_json?: Json
          id?: string
          incentive_cents_per_complete?: number
          line_items_json?: Json
          pricing_config_version?: number
          study_id?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_pricing_config_version_fkey"
            columns: ["pricing_config_version"]
            isOneToOne: false
            referencedRelation: "pricing_configs"
            referencedColumns: ["version"]
          },
          {
            foreignKeyName: "quotes_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          bonus_payout_id: string | null
          created_at: string
          id: string
          referee_id: string
          referrer_id: string
          state: string
          updated_at: string
        }
        Insert: {
          bonus_payout_id?: string | null
          created_at?: string
          id?: string
          referee_id: string
          referrer_id: string
          state: string
          updated_at?: string
        }
        Update: {
          bonus_payout_id?: string | null
          created_at?: string
          id?: string
          referee_id?: string
          referrer_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_bonus_payout_id_fkey"
            columns: ["bonus_payout_id"]
            isOneToOne: true
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referee_id_fkey"
            columns: ["referee_id"]
            isOneToOne: true
            referencedRelation: "respondents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "respondents"
            referencedColumns: ["id"]
          },
        ]
      }
      removals: {
        Row: {
          created_at: string
          id: string
          reason: string
          replacement_invite_id: string | null
          session_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason: string
          replacement_invite_id?: string | null
          session_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          replacement_invite_id?: string | null
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "removals_replacement_invite_id_fkey"
            columns: ["replacement_invite_id"]
            isOneToOne: false
            referencedRelation: "invites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "removals_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          id: string
          qualified_policy_digest: string | null
          qualified_qualification_digest: string | null
          qualified_summary_json: Json | null
          state: string
          study_id: string
          summary_json: Json
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          qualified_policy_digest?: string | null
          qualified_qualification_digest?: string | null
          qualified_summary_json?: Json | null
          state: string
          study_id: string
          summary_json: Json
          updated_at?: string
          version: number
        }
        Update: {
          created_at?: string
          id?: string
          qualified_policy_digest?: string | null
          qualified_qualification_digest?: string | null
          qualified_summary_json?: Json | null
          state?: string
          study_id?: string
          summary_json?: Json
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "reports_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      researchers: {
        Row: {
          auth_user_id: string
          created_at: string
          id: string
          organization_id: string
          role: string
          terms_accepted_at: string
          terms_version: string
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          id?: string
          organization_id: string
          role?: string
          terms_accepted_at: string
          terms_version: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          role?: string
          terms_accepted_at?: string
          terms_version?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "researchers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      respondents: {
        Row: {
          age_attested_at: string
          auth_user_id: string
          created_at: string
          id: string
          quality_level: string
          referral_code: string
          status: string
          updated_at: string
          whatsapp_waitlist_at: string | null
          ytd_payout_cents: number
          ytd_payout_year: number
        }
        Insert: {
          age_attested_at: string
          auth_user_id: string
          created_at?: string
          id?: string
          quality_level?: string
          referral_code?: string
          status?: string
          updated_at?: string
          whatsapp_waitlist_at?: string | null
          ytd_payout_cents?: number
          ytd_payout_year?: number
        }
        Update: {
          age_attested_at?: string
          auth_user_id?: string
          created_at?: string
          id?: string
          quality_level?: string
          referral_code?: string
          status?: string
          updated_at?: string
          whatsapp_waitlist_at?: string | null
          ytd_payout_cents?: number
          ytd_payout_year?: number
        }
        Relationships: []
      }
      screener_answers: {
        Row: {
          created_at: string
          id: string
          invite_id: string
          key: string
          updated_at: string
          value_json: Json
        }
        Insert: {
          created_at?: string
          id?: string
          invite_id: string
          key: string
          updated_at?: string
          value_json: Json
        }
        Update: {
          created_at?: string
          id?: string
          invite_id?: string
          key?: string
          updated_at?: string
          value_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "screener_answers_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "invites"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          created_at: string
          id: string
          invite_id: string
          liveness_passed: boolean | null
          liveness_phrase: string | null
          started_at: string
          state: string
          study_id: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          invite_id: string
          liveness_passed?: boolean | null
          liveness_phrase?: string | null
          started_at?: string
          state?: string
          study_id: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          invite_id?: string
          liveness_passed?: boolean | null
          liveness_phrase?: string | null
          started_at?: string
          state?: string
          study_id?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_invite_id_study_id_fkey"
            columns: ["invite_id", "study_id"]
            isOneToOne: false
            referencedRelation: "invites"
            referencedColumns: ["id", "study_id"]
          },
        ]
      }
      studies: {
        Row: {
          created_at: string
          deadline_at: string | null
          id: string
          labels: Json
          length_minutes: number
          organization_id: string
          state: string
          target_completes: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deadline_at?: string | null
          id?: string
          labels?: Json
          length_minutes: number
          organization_id: string
          state?: string
          target_completes: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deadline_at?: string | null
          id?: string
          labels?: Json
          length_minutes?: number
          organization_id?: string
          state?: string
          target_completes?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "studies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      transcripts: {
        Row: {
          answer_id: string
          cost_micros: number
          created_at: string
          id: string
          latency_ms: number
          model: string
          provider: string
          redacted_source_version: string
          redacted_text: string | null
          study_id: string
          updated_at: string
        }
        Insert: {
          answer_id: string
          cost_micros: number
          created_at?: string
          id?: string
          latency_ms: number
          model: string
          provider: string
          redacted_source_version?: string
          redacted_text?: string | null
          study_id: string
          updated_at?: string
        }
        Update: {
          answer_id?: string
          cost_micros?: number
          created_at?: string
          id?: string
          latency_ms?: number
          model?: string
          provider?: string
          redacted_source_version?: string
          redacted_text?: string | null
          study_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcripts_answer_id_study_id_fkey"
            columns: ["answer_id", "study_id"]
            isOneToOne: false
            referencedRelation: "answers"
            referencedColumns: ["id", "study_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      begin_gate3_probe_turn: {
        Args: {
          supplied_answer_id: string
          supplied_auth_user_id: string
          supplied_browser_upload_ms: number
        }
        Returns: string
      }
      claim_gate1_answer_job: {
        Args: { supplied_answer_id?: string }
        Returns: Json
      }
      claim_gate2_checkout_intent: {
        Args: { supplied_quote_id: string; supplied_study_id: string }
        Returns: Json
      }
      claim_gate2_nudge_delivery: {
        Args: { supplied_claim_id: string; supplied_delivery_id: string }
        Returns: Json
      }
      claim_gate2_refund_intent: {
        Args: {
          requested_reservation_id: string
          supplied_auth_user_id: string
        }
        Returns: Json
      }
      commit_gate2_screening_decision: {
        Args: {
          requested_action: string
          requested_answer_id: string
          requested_confirmed: boolean
          requested_end: number
          requested_interpretation: string
          requested_rule_id: string
          requested_start: number
          requested_version: number
        }
        Returns: Json
      }
      commit_gate3_probe_decision: {
        Args: {
          supplied_answer_id: string
          supplied_auth_user_id: string
          supplied_decision: Json
          supplied_question_id: string
          supplied_session_id: string
          supplied_source_version: string
          supplied_transcript_revision: string
          supplied_turn_id: string
        }
        Returns: Json
      }
      complete_gate1_answer_job: {
        Args: {
          supplied_answer_id: string
          supplied_cost_micros?: number
          supplied_latency_ms?: number
          supplied_lease_id: string
          supplied_model?: string
          supplied_policy_digest?: string
          supplied_provider?: string
          supplied_qualification_digest?: string
          supplied_raw_text?: string
          supplied_redacted_text?: string
          supplied_redaction_passed?: boolean
        }
        Returns: Json
      }
      confirm_gate1_voice_answer: {
        Args: {
          supplied_answer_id: string
          supplied_audio_id: string
          supplied_duration_ms: number
          supplied_owner_id: string
          supplied_question_id: string
          supplied_replace_answer_id?: string
          supplied_session_id: string
          supplied_sha256: string
        }
        Returns: Json
      }
      create_gate1_study: {
        Args: {
          draft: Json
          predicates: Json
          supplied_organization_id: string
          supplied_researcher_id: string
          supplied_study_id: string
        }
        Returns: Json
      }
      create_gate2_marketplace_offers: {
        Args: {
          requested_count: number
          supplied_auth_user_id: string
          supplied_quote_id: string
          supplied_study_id: string
        }
        Returns: Json
      }
      create_gate2_paid_launch_wave: {
        Args: { supplied_quote_id: string; supplied_study_id: string }
        Returns: Json
      }
      decide_gate2_marketplace_quality: {
        Args: {
          supplied_actor_auth_id: string
          supplied_components: Json
          supplied_decision: string
          supplied_quote_id: string
          supplied_reason: string
          supplied_score: number
          supplied_session_id: string
          supplied_study_id: string
        }
        Returns: Json
      }
      expire_gate1_interviews: {
        Args: { supplied_cutoff: string }
        Returns: Json
      }
      freeze_gate2_marketplace_quote: {
        Args: {
          supplied_auth_user_id: string
          supplied_brief_version: number
          supplied_config_id: string
          supplied_config_version: number
          supplied_incentive_cents: number
          supplied_line_items: Json
          supplied_study_id: string
          supplied_total_cents: number
        }
        Returns: string
      }
      freeze_gate2_quote: {
        Args: {
          supplied_brief_version: number
          supplied_config_id: string
          supplied_config_version: number
          supplied_feasibility: Json
          supplied_incentive_cents: number
          supplied_line_items: Json
          supplied_study_id: string
          supplied_total_cents: number
        }
        Returns: string
      }
      gate2_guide_digest: {
        Args: { supplied_study_id: string }
        Returns: string
      }
      get_gate1_study_tracking: {
        Args: { supplied_study_id: string }
        Returns: Json
      }
      get_gate2_screening_decision: {
        Args: { requested_answer_id: string }
        Returns: Json
      }
      get_gate2_screening_rule: {
        Args: {
          requested_rule_id: string
          requested_study_id: string
          requested_version: number
        }
        Returns: Json
      }
      launch_gate1_study: {
        Args: {
          supplied_organization_id: string
          supplied_researcher_id: string
          supplied_study_id: string
        }
        Returns: Json
      }
      launch_gate2_paid_study: {
        Args: {
          supplied_provider_event_id: string
          supplied_quote_id: string
          supplied_study_id: string
        }
        Returns: boolean
      }
      launch_gate2_paid_study_checked: {
        Args: {
          supplied_provider_event_id: string
          supplied_quote_id: string
          supplied_study_id: string
        }
        Returns: boolean
      }
      list_gate1_expired_audio: {
        Args: { supplied_limit: number }
        Returns: {
          storage_path: string
        }[]
      }
      list_gate1_home_invites: { Args: never; Returns: Json }
      list_gate2_nudge_candidates: { Args: never; Returns: Json }
      list_gate2_nudge_dispatchable: { Args: never; Returns: Json }
      list_gate3_probe_due: { Args: { supplied_limit: number }; Returns: Json }
      list_gate3_probe_render_due: {
        Args: { supplied_limit: number }
        Returns: Json
      }
      mark_gate3_probe_shown: {
        Args: {
          supplied_auth_user_id: string
          supplied_browser_rendered_ms: number
          supplied_probe_id: string
          supplied_session_id: string
          supplied_turn_id: string
        }
        Returns: string
      }
      observe_gate2_nudge_delivery: {
        Args: {
          supplied_claim_id: string
          supplied_delivery_id: string
          supplied_state: string
        }
        Returns: boolean
      }
      prepare_gate2_nudge_deliveries: {
        Args: { supplied_outbox_id: string }
        Returns: Json
      }
      provision_email_respondent: {
        Args: { supplied_user_id: string }
        Returns: string
      }
      provision_respondent: {
        Args: {
          supplied_ciphertext: string
          supplied_hash: string
          supplied_user_id: string
        }
        Returns: string
      }
      queue_gate2_nudge: {
        Args: {
          supplied_invite_id: string
          supplied_key: string
          supplied_kind: string
          supplied_session_id: string
        }
        Returns: boolean
      }
      read_gate1_audio_reservation: {
        Args: {
          supplied_audio_id: string
          supplied_question_id: string
          supplied_session_id: string
        }
        Returns: Json
      }
      read_gate1_researcher_transcripts: {
        Args: { supplied_study_id: string }
        Returns: {
          id: string
          redacted_text: string
          respondent_number: number
          student: boolean
        }[]
      }
      read_gate2_current_researcher_receipt: {
        Args: { supplied_study_id: string }
        Returns: Json
      }
      read_gate2_current_respondent_earnings: { Args: never; Returns: Json }
      read_gate2_marketplace_feasibility: {
        Args: { supplied_auth_user_id: string; supplied_study_id: string }
        Returns: Json
      }
      read_gate2_referral_self: { Args: never; Returns: Json }
      read_gate2_refund_webhook_claim: {
        Args: { requested_reservation_id: string }
        Returns: Json
      }
      read_gate2_sandbox_visa_recipient: {
        Args: { requested_payout_id: string }
        Returns: Json
      }
      read_gate2_screening_sheet: {
        Args: { supplied_invite_id: string }
        Returns: Json
      }
      read_gate3_committed_probe: {
        Args: {
          supplied_auth_user_id: string
          supplied_session_id: string
          supplied_turn_id: string
        }
        Returns: Json
      }
      read_gate3_probe_opportunity_snapshot: {
        Args: { supplied_study_id: string }
        Returns: Json
      }
      read_gate3_ready_probe_turn: {
        Args: {
          supplied_auth_user_id: string
          supplied_session_id: string
          supplied_turn_id: string
        }
        Returns: Json
      }
      read_gate3_respondent_probe: {
        Args: { supplied_auth_user_id: string; supplied_session_id: string }
        Returns: Json
      }
      record_gate1_text_answer: {
        Args: {
          supplied_answer_id: string
          supplied_question_id: string
          supplied_replace_answer_id?: string
          supplied_session_id: string
          supplied_text: string
        }
        Returns: Json
      }
      record_gate2_payout_observation: {
        Args: {
          requested_amount_cents: number
          requested_event_id: string
          requested_kind: string
          requested_observed_at: string
          requested_order_id: string
          requested_payout_id: string
        }
        Returns: boolean
      }
      record_gate2_refund_observation: {
        Args: {
          requested_amount_cents: number
          requested_kind: string
          requested_observed_at: string
          requested_refund_id: string
          requested_reservation_id: string
        }
        Returns: boolean
      }
      record_gate2_sandbox_visa_observation: {
        Args: {
          requested_amount_cents: number
          requested_event_id: string
          requested_kind: string
          requested_observed_at: string
          requested_order_id: string
          requested_payout_id: string
          requested_product_id: string
          requested_recipient_id: string
        }
        Returns: boolean
      }
      record_gate3_probe_render_terminal: {
        Args: { supplied_auth_user_id: string; supplied_turn_id: string }
        Returns: Json
      }
      record_gate3_probe_text_answer: {
        Args: {
          supplied_answer_id: string
          supplied_auth_user_id: string
          supplied_probe_id: string
          supplied_session_id: string
          supplied_text: string
          supplied_turn_id: string
        }
        Returns: Json
      }
      record_gate3_probe_timeout: {
        Args: { supplied_answer_id: string; supplied_auth_user_id: string }
        Returns: Json
      }
      register_gate2_push_subscription: {
        Args: {
          supplied_auth: string
          supplied_endpoint: string
          supplied_p256dh: string
        }
        Returns: boolean
      }
      register_gate2_referral: {
        Args: { supplied_referral_code: string }
        Returns: string
      }
      remove_gate2_push_subscription: {
        Args: { supplied_endpoint: string }
        Returns: boolean
      }
      requeue_gate1_answer_job: {
        Args: { supplied_answer_id: string }
        Returns: boolean
      }
      reserve_gate1_audio: {
        Args: {
          supplied_bytes: number
          supplied_mime: string
          supplied_question_id: string
          supplied_session_id: string
        }
        Returns: Json
      }
      reserve_gate2_sandbox_visa_intent: {
        Args: { annual_cap_cents: number; requested_session_id: string }
        Returns: Json
      }
      reserve_gate2_session_payout: {
        Args: {
          annual_cap_cents: number
          requested_amount_cents: number
          requested_key: string
          requested_respondent_id: string
          requested_session_id: string
        }
        Returns: string
      }
      reserve_gate2_unfilled_slot_refund: {
        Args: {
          supplied_auth_user_id: string
          supplied_quote_id: string
          supplied_study_id: string
        }
        Returns: Json
      }
      retry_gate1_answer_job: {
        Args: {
          supplied_answer_id: string
          supplied_delay_seconds?: number
          supplied_lease_id: string
        }
        Returns: boolean
      }
      save_gate1_consent: { Args: { decisions: Json }; Returns: boolean }
      save_gate1_profile: { Args: { attributes: Json }; Returns: boolean }
      snooze_gate2_nudge: {
        Args: { supplied_invite_id: string }
        Returns: string
      }
      start_gate1_session: {
        Args: { supplied_invite_id: string }
        Returns: Json
      }
      store_gate2_screening_answer: {
        Args: {
          requested_consent_version: string
          requested_invite_id: string
          requested_key: string
          requested_kind: string
          requested_respondent_id: string
          requested_rule_id: string
          requested_study_id: string
          requested_text: string
          requested_version: number
        }
        Returns: Json
      }
      submit_gate1_session: {
        Args: { supplied_session_id: string }
        Returns: Json
      }
      submit_gate2_screening_text: {
        Args: {
          supplied_invite_id: string
          supplied_key: string
          supplied_rule_id: string
          supplied_text: string
          supplied_version: number
        }
        Returns: Json
      }
      update_gate1_invite: {
        Args: { supplied_action: string; supplied_invite_id: string }
        Returns: Json
      }
      validate_gate1_answer_job: {
        Args: { supplied_answer_id: string; supplied_lease_id: string }
        Returns: boolean
      }
      verify_gate2_referred_profile: { Args: never; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

