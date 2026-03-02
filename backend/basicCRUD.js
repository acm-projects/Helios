const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://navmihs23_db_user:27epb7wwi50ESjTO@cluster0.nl8eux7.mongodb.net/?appName=Cluster0';
const client = new MongoClient(uri);
// json file will be given by the algorithm 
// create new user that gives a json fil and the functio will just take the new user
// function createNewUser(userId, id, name, url, apiKey, secretKey){
//   return {
//     _id: id,
//     userId: userId,
//     name: name,
//     url: url,
//     apiKey: apiKey,
//     secretKey: secretKey
//   };
// }

// function(name, age, email) {
//     const newUser = { name: name, age: age, email: email };
//     const createResult = await collection.insertOne(newUser);
//     console.log('Created:', createResult.insertedId);}
const newUserT = {"name": "navmi", "_id": "456"};
const newUserT2 = {"name": "extra", "_id": "123", "material" : "plastic", "color" : "red" };

async function extra() {
  // // CREATE - insert a document
  //   const newUserT = {"name": "navmi", "_id": "235"};
  //   const newUserT2 = {"name": "ram", "_id": "123", "material" : "plastic", "color" : "red" };
    //const newUser = createNewUser("user123", "id456", "Alice", "https://example.com", "api_key_789", "secret_key_xyz");
    // const createResult = await collection.insertOne(newUserT);
    // console.log('Created:', createResult.insertedId);
    // const createResult2 = await collection.insertOne(newUserT2);
    // console.log('Created:', createResult2.insertedId);

    // READ - find a document
    // Read need to spit out json file with url, key  
    const user = await collection.findOne({ userId: "user123" });
    console.log('Read:', user);

    // UPDATE - modify a document
    const updateResult = await collection.updateOne(
      { name: 'Alice' },
      { $set: { age: 26 } }
    );
    console.log('Updated:', updateResult.modifiedCount, 'document(s)');

    // DELETE - remove a document
    const deleteResult = await collection.deleteOne({ name: 'Alice' });
    console.log('Deleted:', deleteResult.deletedCount, 'document(s)');

};

async function run() {
  try {
    await client.connect();
    const db = client.db('myDatabase');
    const collection = db.collection('users');

    const createResult = await collection.insertOne(newUserT);
    console.log('Created:', createResult.insertedId);
    const createResult2 = await collection.insertOne(newUserT2);
    console.log('Created:', createResult2.insertedId);


  } finally {
    await client.close();
  }
}

run().catch(console.error);