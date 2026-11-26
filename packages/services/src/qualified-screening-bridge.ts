import { readGate2QualifiedScreeningSource,
  type QualifiedScreeningSource } from "./qualified-screening-source.js";

type Database = Parameters<typeof readGate2QualifiedScreeningSource>[0];
type Request = Parameters<typeof readGate2QualifiedScreeningSource>[1];
type Span = { startChar: number; endChar: number };
type Model = {
  interpret(source: QualifiedScreeningSource): Promise<unknown>;
  evidenceSupports(source: QualifiedScreeningSource & {
    result: "supported" | "contradicted"; span: Span }): Promise<boolean>;
};

/** No raw answer is accepted by this bridge. The model receives only the
 * current qualified source read from the private database function. */
export function createQualifiedScreeningBridge(db: Database, model: Model) {
  return {
    async interpret(request: Request): Promise<{
      source: QualifiedScreeningSource; interpretation: unknown } | null> {
      const source = await readGate2QualifiedScreeningSource(db, request);
      if (!source) return null;
      try { return { source, interpretation: await model.interpret(source) }; }
      catch { return null; }
    },
    async evidenceSupports(request: Request, original: QualifiedScreeningSource,
      result: "supported" | "contradicted", span: Span): Promise<boolean> {
      const source = await readGate2QualifiedScreeningSource(db, request);
      if (!source || source.redactedSourceVersion !== original.redactedSourceVersion ||
          source.redactionPolicyDigest !== original.redactionPolicyDigest ||
          source.answerText !== original.answerText ||
          source.criterionText !== original.criterionText ||
          source.question !== original.question ||
          !Number.isSafeInteger(span.startChar) || !Number.isSafeInteger(span.endChar) ||
          span.startChar < 0 || span.endChar <= span.startChar ||
          span.endChar > Array.from(source.answerText).length) return false;
      try { return await model.evidenceSupports({ ...source, result, span }) === true; }
      catch { return false; }
    },
  };
}
