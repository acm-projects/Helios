import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let collection;

export async function connectMongo() {
  await client.connect();
  const db = client.db('myDatabase');
  collection = db.collection('users');
}

export async function createMongo(document) {
  const result = await collection.insertOne(document);
  console.log('Created:', result.insertedId);
  return result.insertedId;
}

export async function getMongo(query) {
  const user = await collection.findOne(query);
  console.log('Read:', user);
  return user;
}

export async function updateMongo(filter, updates) {
  const result = await collection.updateOne(filter, { $set: updates });
  console.log('Updated:', result.modifiedCount, 'document(s)');
  return result.modifiedCount;
}

async function removeMongo(query) {
  const result = await collection.deleteOne(query);
  console.log('Deleted:', result.deletedCount, 'document(s)');
  return result.deletedCount;
}

async function run() {
  
}

run().catch(console.error);

// module.exports = { connectMongo, createMongo, getMongo, updateMongo, removeMongo };

//if you need to import put this at the top:
