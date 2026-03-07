const {connectMongo, createMongo, getMongo, updateMongo, removeMongo} = require('./crud');


async function main(): Promise<void> {
  await connectMongo();


  const user = await getMongo({ name: 'navmi' });

}

main().catch(console.error);