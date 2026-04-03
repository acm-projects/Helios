import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

console.log("Loaded MONGODB_URI:", process.env.MONGODB_URI);
console.log("Connecting to MongoDB with URI:", process.env.MONGODB_URI);

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let db;

// Connect once and reuse
export async function connectMongo() {
  if (!db) {
    try {
      await client.connect();
      db = client.db("myDatabase");
      console.log("MongoDB connected");
    } catch (err) {
      console.error("MongoDB connection error:", err);
      throw err;
    }
  }
  return db;
}


// Get any collection
export function getCollection(collectionName) {
  if (!db) {
    throw new Error("Database not connected. Call connectMongo() first.");
  }
  return db.collection(collectionName);
}

// Generic CRUD

// createDocument is used for inserting new records.
export async function createDocument(collectionName, data) {
  const col = getCollection(collectionName);
  return col.insertOne(data);
}

// readDocument retrieves a single document based on the query.
export async function readDocument(collectionName, query) {
  const col = getCollection(collectionName);
  return col.findOne(query);
}

// updateDocument ensures partial updates with $set.
// Flexible schema allows for optional fields like expiresAt and unprocessedSecret.
export async function updateDocument(collectionName, filter, updates) {
  const col = getCollection(collectionName);
  const result = await col.updateOne(filter, { $set: updates });
  return result.modifiedCount;
}

export async function deleteDocument(collectionName, query) {
  const col = getCollection(collectionName);
  const result = await col.deleteOne(query);
  return result.deletedCount;
}
