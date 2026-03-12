//run main: npx tsx main.ts
//ex spec urls:
/*
https://petstore.swagger.io/v2/swagger.json
*/

import OpenAI from "openai";
//tool generation functions
import { promptForApiUrl, generateToolRegistry, parseSwaggerUrl } from "./generate_tool_registry.ts";
import { writeFileSync } from "fs";
//database functions
import { connectMongo, createMongo, getMongo, getAllMongo, removeMongo } from "./crud.js";
//sandbox client functions
import { initializeAgent, getTools, callTool, messageAI } from "./sandbox.ts";
//allows user to talk with chat in temrinal
import * as readline from "readline";

async function main(): Promise<void> {
  //connect to database
  await connectMongo();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Helper to prompt user
  const askQuestion = (query: string): Promise<string> => {
    return new Promise((resolve) => rl.question(query, resolve));
  };

  let savedApiSpec: any = null;

  while (true) {
    console.log("\n=============================");
    console.log("    TOOLS CONFIGURATION      ");
    console.log("=============================");
    console.log("[1] Use an existing tool spec");
    console.log("[2] Delete an existing tool spec");
    console.log("[3] Create a new tool spec");
    console.log("[4] Exit");

    const choice = (await askQuestion("\nChoose an option (1-4): ")).trim();

    if (choice === "1") {
      const allSpecs = await getAllMongo();
      if (allSpecs.length === 0) {
        console.log("No saved specs found. Please create one first.");
        continue;
      }

      console.log("\n--- Available Specs ---");
      allSpecs.forEach((spec: any, index: number) => {
        console.log(`${index + 1}. ${spec._id} ${spec.info?.title ? `(${spec.info.title})` : ""}`);
      });

      const selection = await askQuestion("\nEnter the number of the spec to use (or 'c' to cancel): ");
      if (selection.toLowerCase() === 'c') continue;

      const specIndex = parseInt(selection) - 1;
      if (specIndex >= 0 && specIndex < allSpecs.length) {
        savedApiSpec = allSpecs[specIndex];
        console.log(`\nLoading spec: ${savedApiSpec._id}`);
        break; // break the menu loop to proceed to sandbox
      } else {
        console.log("Invalid selection.");
      }
    }
    else if (choice === "2") {
      const allSpecs = await getAllMongo();
      if (allSpecs.length === 0) {
        console.log("No saved specs found to delete.");
        continue;
      }

      console.log("\n--- Delete Spec ---");
      allSpecs.forEach((spec: any, index: number) => {
        console.log(`${index + 1}. ${spec._id}`);
      });

      const selection = await askQuestion("\nEnter the number of the spec to delete (or 'c' to cancel): ");
      if (selection.toLowerCase() === 'c') continue;

      const specIndex = parseInt(selection) - 1;
      if (specIndex >= 0 && specIndex < allSpecs.length) {
        const specToDelete = allSpecs[specIndex];
        const confirm = await askQuestion(`Are you sure you want to delete '${specToDelete._id}'? (y/n): `);
        if (confirm.toLowerCase() === 'y') {
          await removeMongo({ _id: specToDelete._id });
          console.log(`Spec '${specToDelete._id}' deleted successfully.`);
        }
      } else {
        console.log("Invalid selection.");
      }
    }
    else if (choice === "3") {
      let specUrl = await askQuestion("\nWhat is your API spec URL (or 'c' to cancel)? ");
      specUrl = specUrl.trim();
      if (specUrl.toLowerCase() === 'c') continue;
      if (!specUrl) {
        console.log("Error: No API spec URL provided.");
        continue;
      }

      let spec: any;
      try {
        spec = await parseSwaggerUrl(specUrl);
      } catch (err: any) {
        console.log(`Failed to fetch spec from: ${specUrl}`);
        console.log(err.message);
        continue;
      }

      let specId = "";
      let isUnique = false;

      while (!isUnique) {
        specId = await askQuestion("What name do you want to save this tools.json under? ");
        specId = specId.trim();

        if (!specId) {
          console.log("Name cannot be empty. Please try again.");
          continue;
        }

        // Check if it already exists in the database
        const existingSpec = await getMongo({ _id: specId });
        if (existingSpec) {
          console.log(`The name '${specId}' is already taken. Please choose another name.`);
        } else {
          isUnique = true;
        }
      }

      //saves a key to add to database (we can look up the same spec with that id later)
      spec._id = specId;
      await createMongo(spec);

      //set the loaded spec
      savedApiSpec = await getMongo({ _id: specId });
      console.log(`\nNew spec '${specId}' created and loaded.`);
      break; // break the menu loop to proceed to sandbox
    }
    else if (choice === "4") {
      console.log("Exiting...");
      process.exit(0);
    }
    else {
      console.log("Invalid option selected. Please choose 1, 2, 3, or 4.");
    }
  }

  //-----------------------------------------------------------------------------------------------------------------------------------------------------

  //create tools from spec url content
  try {
    const registry = await generateToolRegistry(savedApiSpec);
    writeFileSync("tools.json", JSON.stringify(registry, null, 2));
  } catch (err: any) {
    console.error(`Failed to parse API spec`);
    console.error(err.message);
    process.exit(1);
  }

  //initialize sandbox llm to use tools
  const sessionId = await initializeAgent();
  //get tools for llm
  const tools = await getTools(sessionId);

  //tools isnt in the right format for openai so we need to change the format\
  const openAITools = tools.map(tool => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }));

  //make a history array that records chat activities
  const history: OpenAI.Chat.ChatCompletionMessageParam[] = [];  //open chat message for user
  console.log("-------------------------------------------------")
  console.log("|Welcome to your sanbox server test your tools: |")
  console.log("-------------------------------------------------")

  while (true) {
    //prompt user the message

    const userInput = await new Promise<string>((resolve) => {
      rl.question("You: ", resolve)
    })
    //push user message into history
    history.push({ role: "user", content: userInput });

    //send user reply to ai and wait for responce
    const message = await messageAI(history, openAITools)


    if (message.tool_calls != null) {
      //add agents tool call message into history
      history.push(message);
      //getting tool variables from message and parse them into obj
      const toolCall = message.tool_calls[0];
      if (toolCall.type === "function") {
        const toolName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);
        const toolResponse = await callTool(sessionId, toolName, args)

        //debugging
        console.log("Tool response:", JSON.stringify(toolResponse))

        history.push({
          role: "tool",
          tool_call_id: message.tool_calls[0].id,
          content: JSON.stringify(toolResponse)
        });

        const toolMessage = await messageAI(history, openAITools);
        console.log("Agent: " + toolMessage.content);
        if (toolMessage.content) {
          history.push({ role: "assistant", content: toolMessage.content });
        }
      }
    }
    else {
      console.log("Agent: " + message.content)
      if (message.content) {
        history.push({ role: "assistant", content: message.content })
      }
    }
  }



}

main().catch(console.error);