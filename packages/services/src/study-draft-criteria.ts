export const gate1CriterionChoices = [
  { text: "Ordered food after 10 pm in the last 30 days", attributeKey: "ordered_food_after_10pm_last_30_days", operator: "eq", value: true },
  { text: "Currently a student", attributeKey: "student", operator: "eq", value: true },
  { text: "Lives on campus", attributeKey: "lives_on_campus", operator: "eq", value: true },
  { text: "Prefers ordering food in an app", attributeKey: "preferred_food_order_channel", operator: "eq", value: "app" },
  { text: "Orders food at least once a week", attributeKey: "food_orders_per_week", operator: "gte", value: 1 },
] as const;
