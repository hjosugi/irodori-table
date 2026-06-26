// MongoDB feature sample for Irodori Table.
// Run against `make db-up DB=mongodb` using mongosh, or paste the collection
// query examples into Irodori's MongoDB query box.

db = db.getSiblingDB("samples");

db.customers.createIndex({ tier: 1 });

db.customers.find(
  { tier: "gold" },
  { name: 1, tier: 1 }
).sort({ name: 1 });

db.customers.aggregate([
  { $group: { _id: "$tier", count: { $sum: 1 }, names: { $push: "$name" } } },
  { $sort: { _id: 1 } }
]);

// Irodori MongoDB query input examples:
// customers
// {"collection":"customers","filter":{"tier":"gold"}}
