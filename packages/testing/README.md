# testing

Shared fixtures, factories and provider fakes.

`fixtureFactory(OrganizationSchema)` builds independent objects and validates
overrides. It works with every example-bearing object contract.

`TestClock` advances fixture time without timers. `FakeTwilio` accepts an
explicit fixture code and clock. `FakeStripe` and `FakeTremendous` retain
idempotency receipts in memory. `FakeLLM` runs from a script or a map keyed by
request hash. `FakeTranscriber` uses a map keyed by audio hash.
