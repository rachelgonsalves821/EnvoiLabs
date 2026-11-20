/**
 * Instantiate any example-bearing contract with typed overrides.
 * Parse both before and after overriding to keep fixtures isolated and valid.
 */
export function fixtureFactory<Value>(contract: {
  meta(): { examples?: unknown } | undefined;
  parse(value: unknown): Value;
}) {
  const examples = contract.meta()?.examples;
  const example: unknown = Array.isArray(examples) ? examples[0] : undefined;
  if (example === undefined) throw new Error("Cannot build a fixture for a contract without an example.");
  const canonical = contract.parse(example);

  return (overrides?: Partial<Value>): Value => {
    if (overrides === undefined) return contract.parse(structuredClone(canonical));
    if (typeof canonical !== "object" || canonical === null || Array.isArray(canonical)) {
      throw new Error("Fixture overrides require an object contract.");
    }
    return contract.parse({ ...structuredClone(canonical), ...structuredClone(overrides) });
  };
}
