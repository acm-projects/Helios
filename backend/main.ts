import { promptForApiUrl, generateToolRegistry, parseSwaggerUrl } from "./generate_tool_registry.ts";
import { writeFileSync } from "fs";

import {connectMongo, createMongo, getMongo} from './crud.js';
// const {connectMongo, createMongo, getMongo, updateMongo, removeMongo} = require('./crud.js');


async function main(): Promise<void> {
  await connectMongo();

  // GETTING SPEC URL AND UPLOADING SPEC INTO MONGO
  const specPathOrUrl = process.argv[2] || (await promptForApiUrl());

  if (!specPathOrUrl) {
    console.error("Error: No API spec path or URL provided.");
    process.exit(1);
  }
  var spec;

  try {
    spec = await parseSwaggerUrl(specPathOrUrl);
  } catch (err: any) {
    console.error(`Failed to fetch spec from: ${specPathOrUrl}`);
    console.error(err.message);
    process.exit(1);
  }

  spec._id = "api_spec";
  createMongo(spec)

  // --

  // RETRIEVING SPEC FROM MONGO

  const savedApiSpec = await getMongo({ _id: "api_spec" });

  try {
    const registry = await generateToolRegistry(savedApiSpec);
    writeFileSync("tools.json", JSON.stringify(registry, null, 2));
  } catch (err: any) {
    console.error(`Failed to parse API spec`);
    console.error(err.message);
    process.exit(1);
  }
  
}

main().catch(console.error);