-- The later push-notification migration must preserve the distinct private
-- AI follow-up purpose introduced by the probe ledger. No onboarding flow
-- grants this purpose and no live model path is enabled by this constraint.
alter table public.consents drop constraint consents_purpose_check;
alter table public.consents add constraint consents_purpose_check check (purpose in (
    'recording', 'transcription_vendor', 'retention', 'researcher_access',
    'voice_clip_sharing', 'push_notifications', 'ai_followup'
));
