// Seed for the MongoDB sample (runs on first container init).
db = db.getSiblingDB("samples");
db.customers.insertMany([
  { _id: 1, name: "Kawase Foods", tier: "gold" },
  { _id: 2, name: "Northwind Retail", tier: "silver" },
  { _id: 3, name: "Aster Works" },
  { _id: 4, name: "Minato Labs", tier: "gold" },
]);
