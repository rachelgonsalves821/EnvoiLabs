-- The earlier raw-answer decision entry point predates purpose-specific
-- consent and qualified-source version binding. Only the newer restricted
-- commit_gate2_qualified_screening_decision may advance a screened offer.
revoke all on function public.commit_gate2_screening_decision(
    uuid, uuid, integer, text, integer, integer, text, boolean)
    from public, anon, authenticated, service_role;
