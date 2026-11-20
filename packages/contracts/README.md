# Shared contracts

Zod schemas and inferred types for public entities, Gate 1 APIs, analytics, and AI
outputs. Top-level schemas carry synthetic fixtures in `schema.meta()?.examples`.
The IT-0.3 suite checks their JSON round trip. Researcher transcripts expose
redacted text and omit raw transcripts, contact data, storage paths, and provider IDs.

## Private v1 distribution

Download the `envoi-labs-contracts-<commit>` artifact from a successful main CI run. The archive contains the npm tarball with compiled JavaScript, TypeScript declarations and the package manifest. Use the commit in the artifact name to identify the exact build. CI unpacks the tarball, resolves the public package entry point and parses a brief fixture before uploading it.
