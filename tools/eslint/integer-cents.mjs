const centsName = /(?:^cents$|Cents$|_cents$|(?:^|_)CENTS$)/;

function fieldName(key, computed = false) {
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  if (!computed && key.type === "Identifier") return key.name;
}

function targetName(node) {
  if (node.type === "MemberExpression") return fieldName(node.property, node.computed);
  return fieldName(node);
}

// Evaluate only numeric constants. Values supplied at runtime still need schema validation.
const arithmetic = new Map([
  ["+", (a, b) => a + b], ["-", (a, b) => a - b], ["*", (a, b) => a * b],
  ["/", (a, b) => a / b], ["%", (a, b) => a % b], ["**", (a, b) => a ** b],
]);

function constantNumber(node) {
  if (node.type === "Literal" && typeof node.value === "number") return node.value;
  if (["TSAsExpression", "TSTypeAssertion", "TSSatisfiesExpression", "TSNonNullExpression"].includes(node.type)) {
    return constantNumber(node.expression);
  }
  if (node.type === "UnaryExpression" && ["+", "-"].includes(node.operator)) {
    const operand = constantNumber(node.argument);
    if (operand !== undefined) return node.operator === "-" ? -operand : operand;
  }
  if (node.type === "BinaryExpression" && arithmetic.has(node.operator)) {
    const left = constantNumber(node.left);
    const right = constantNumber(node.right);
    if (left !== undefined && right !== undefined) return arithmetic.get(node.operator)(left, right);
  }
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: { integer: "{{name}} must use a safe integer number of cents." },
  },
  create(context) {
    function check(name, value) {
      if (!value || !name || !centsName.test(name)) return;
      if (value.type === "ConditionalExpression") {
        check(name, value.consequent);
        check(name, value.alternate);
        return;
      }
      const amount = constantNumber(value);
      if (amount !== undefined && !Number.isSafeInteger(amount)) {
        context.report({ node: value, messageId: "integer", data: { name } });
      }
    }
    return {
      Property(node) { check(fieldName(node.key, node.computed), node.value); },
      PropertyDefinition(node) { check(fieldName(node.key, node.computed), node.value); },
      VariableDeclarator(node) { check(targetName(node.id), node.init); },
      AssignmentPattern(node) { check(targetName(node.left), node.right); },
      AssignmentExpression(node) {
        // A multiplier can be fractional while the resulting cent amount is integral.
        if (["=", "+=", "-="].includes(node.operator)) check(targetName(node.left), node.right);
      },
    };
  },
};
