const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let collection;

async function connectMongo() {
  await client.connect();
  const db = client.db('myDatabase');
  collection = db.collection('users');
}

async function createMongo(document) {
  const result = await collection.insertOne(document);
  console.log('Created:', result.insertedId);
  return result.insertedId;
}

async function getMongo(query) {
  const user = await collection.findOne(query);
  console.log('Read:', user);
  return user;
}

async function updateMongo(filter, updates) {
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

module.exports = { connectMongo, createMongo, getMongo, updateMongo, removeMongo };

//if you need to import put this at the top:
