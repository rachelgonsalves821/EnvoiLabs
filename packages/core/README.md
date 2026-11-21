# core

Pure domain logic for pricing, matching, state transitions and quality.

The state transition functions accept the current state, event and injected clock.
Each result includes the next state and its audit fields. The service that calls
the function verifies actor scope and persists the state change and audit in one
database transaction. The unpaid test launch requires an explicit server setting
and belongs in a dedicated test or preview environment.
