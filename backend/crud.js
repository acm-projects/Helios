const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let collection;

async function connect() {
  await client.connect();
  const db = client.db('myDatabase');
  collection = db.collection('users');
}

async function create(document) {
  const result = await collection.insertOne(document);
  console.log('Created:', result.insertedId);
  return result.insertedId;
}

async function read(query) {
  const user = await collection.findOne(query);
  console.log('Read:', user);
  return user;
}

async function update(filter, updates) {
  const result = await collection.updateOne(filter, { $set: updates });
  console.log('Updated:', result.modifiedCount, 'document(s)');
  return result.modifiedCount;
}

async function remove(query) {
  const result = await collection.deleteOne(query);
  console.log('Deleted:', result.deletedCount, 'document(s)');
  return result.deletedCount;
}

async function run() {
  try {
    await connect();

    // CREATE
    await create({ userId: 'user123', name: 'Alice', age: 30 });

    // READ
    await read({ userId: 'user123' });

    // UPDATE
    await update({ userId: 'user123' }, { age: 31 });

    // DELETE
    await remove({ name: 'Alice' });

  } finally {
    await client.close();
  }
}

run().catch(console.error);