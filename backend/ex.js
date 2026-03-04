const { MongoClient } = require('mongodb');
require('dotenv').config();
const { generateToolRegistry } = require('./toolalg');

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function createFunc(collection, userData) {
  const result = await collection.insertOne(userData);
  console.log('Created:', result.insertedId);
  return result.insertedId;
}

async function readFunc(collection, query) {
  const doc = await collection.findOne(query);
  return doc;
}

async function run() {
  try {
    await client.connect();
    const db = client.db('myDatabase');
    const collection = db.collection('users');

    const apiJson = [
      {
        name: "get_weather",
        description: "Get current weather for a city",
        method: "GET",
        path: "/weather/{city}",
        parameters: {
          path: {
            city: { type: "string", description: "City name", required: true }
          },
          query: {
            units: { type: "string", description: "celsius or fahrenheit", default: "celsius" }
          }
        }
      }
    ];

    const insertedId = await createFunc(collection, { apiJson });
    const doc = await readFunc(collection, { _id: insertedId });
    const registry = generateToolRegistry(doc.apiJson);
    console.log('Generated tools:', JSON.stringify(registry, null, 2));
    // Store the generated registry back into the database
    const registryId = await createFunc(collection, { registry });
    console.log('Stored registry with id:', registryId);

  } finally {
    await client.close();
  }
}

run().catch(console.error);