import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI environment variable is not set")
const client = new MongoClient(uri);

let collection;

export async function connectMongo() {
  await client.connect();
  const db = client.db('myDatabase');
  collection = db.collection('users');
  await collection.createIndex({ _userId: 1 });
}

export async function createMongo(document, userId) {
  const doc = { ...document, _userId: userId };
  const result = await collection.insertOne(doc);
  return result.insertedId;
}

// userId is optional — omit only for internal lookups that don't need ownership check
export async function getMongo(query, userId) {
  const fullQuery = userId ? { ...query, _userId: userId } : query;
  return collection.findOne(fullQuery);
}

export async function updateMongo(filter, updates, userId) {
  const fullFilter = userId ? { ...filter, _userId: userId } : filter;
  const result = await collection.updateOne(fullFilter, { $set: updates });
  return result.matchedCount;
}

export async function removeMongo(query, userId) {
  const fullQuery = userId ? { ...query, _userId: userId } : query;
  const result = await collection.deleteOne(fullQuery);
  return result.deletedCount;
}

export async function getAllMongo(userId) {
  const query = userId ? { _userId: userId } : {};
  return collection.find(query).toArray();
}
