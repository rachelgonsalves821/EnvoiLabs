import path from "node:path";

export default {
  meta: {
    type: "problem",
    schema: [{ enum: ["researcher", "respondent"] }],
    messages: { crossOwner: "Use a shared package to call code owned by the other route group." },
  },
  create(context) {
    const otherOwner = context.options[0];
    const app = path.resolve(context.cwd, "apps/web/app");
    const forbidden = [path.join(app, "api", otherOwner), path.join(app, "(" + otherOwner + ")")];

    function check(source) {
      const specifier = source?.value;
      if (typeof specifier !== "string" || !specifier.startsWith(".")) return;
      const target = path.resolve(path.dirname(context.filename), specifier);
      if (forbidden.some((root) => target === root || target.startsWith(root + path.sep))) {
        context.report({ node: source, messageId: "crossOwner" });
      }
    }

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};
