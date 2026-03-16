//tool generation functions
import {generateToolRegistry, parseSwaggerUrl } from "./generate_tool_registry.ts";
//database functions
import { connectMongo, createMongo, getMongo, getAllMongo, removeMongo } from "./crud.js";
//sandbox client functions
import {initializeAgent, getTools, callTool, messageAI } from "./sandbox.ts";
import express from "express"
//server functions our "new main"

import cors from "cors"

//start server
const app = express()
app.use(cors())
app.use(express.json()) //tells our server our req, and res are in json format, so we can use calls like req.body.name

//connect to database
await connectMongo()

app.post("/api/spec/parse", async (req, res) => {
    let spec: any
    let specId = ""

    try {
    spec = await parseSwaggerUrl(req.body.url)
    } catch (err: any) {
    return res.status(400).json({ error: "invalid specURL"})
    }

    specId = req.body.name
    
    if (!specId) {
        return res.status(400).json({ error: "name cannot be empty"})
    }

    // Check if it already exists in the database
    const existingSpec = await getMongo({ _id: specId })
    if (existingSpec) {
        return res.status(400).json({ error: "The name is already taken. Please choose another name."})
    } 

    //saves a key to add to database (we can look up the same spec with that id later)
    spec._id = specId
    await createMongo(spec)
    //sends reponse back to the front end
    res.json({ specId })
})

app.post("/api/sandbox/start", async (req, res) => {
    //fetch the spec from mango
    //generate tools from spec
    //initiallize the sandbox

    
    //create tools from spec url content
    let registry: any = null
    try {
        registry = await generateToolRegistry(await getMongo({ _id: req.body.specId }));
    } catch (err: any) {
        return res.status(400).json({ error: "Failed to parse API spec" + err.message})
    }

    //initialize sandbox llm to use tools
    const sessionId = await initializeAgent(registry);
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

    res.json({ sessionId, tools: openAITools })
})

app.post("/api/sandbox/chat", async (req, res) => {
    const history = req.body.history
    history.push({ role: "user", content: req.body.message })

    const message = await messageAI(history, req.body.tools)
    if (message.tool_calls != null) {
        //add agents tool call message into history
        history.push(message);
        //getting tool variables from message and parse them into obj
        const toolCall = message.tool_calls[0];
        if (toolCall.type === "function") {
        const toolName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);
        const toolResponse = await callTool(req.body.sessionId, toolName, args)

        //debugging
        console.log("Tool response:", JSON.stringify(toolResponse))

        history.push({
            role: "tool",
            tool_call_id: message.tool_calls[0].id,
            content: JSON.stringify(toolResponse)
        });

        const toolMessage = await messageAI(history, req.body.tools);
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

    res.json({ reply: history[history.length - 1].content, history })
})



app.listen(8000, () => {
    console.log("api server running on port 8000")
})