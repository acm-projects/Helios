//tool generation functions
import {generateToolRegistry, parseSwaggerUrl } from "./generate_tool_registry.ts";
//database functions
import { connectMongo, createMongo, getMongo, getAllMongo, removeMongo } from "./crud.js";
//sandbox client functions
import {initializeAgent, callTool, messageAI } from "./sandbox.ts";
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

    // Build tools from registry directly — preserves handler (method, path) for the frontend
    const openAITools = registry.tools.map((tool: any) => ({
        type: "function" as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema
        },
        handler: {
            method: tool.handler.method,
            path: tool.handler.path
        }
    }));

    res.json({ sessionId, tools: openAITools })
})

app.post("/api/sandbox/chat", async (req, res) => {
    const MAX_ITERATIONS = 10;
    const TOKEN_BUDGET = 25000;

    const history = req.body.history
    history.push({ role: "user", content: req.body.message })

    let iterations = 0;
    let totalTokens = 0;

    try {
        while (iterations < MAX_ITERATIONS && totalTokens < TOKEN_BUDGET) {
            const { message, tokens } = await messageAI(history, req.body.tools);
            totalTokens += tokens;
            iterations++;

            // AI returned a plain response — it's done thinking
            if (!message.tool_calls || message.tool_calls.length === 0) {
                if (message.content) history.push({ role: "assistant", content: message.content });
                break;
            }

            // AI wants to call a tool — execute it and loop
            history.push(message);
            const toolCall = message.tool_calls[0];
            if (toolCall.type !== "function") break;
            const toolName = toolCall.function.name;

            let args: any;
            try {
                args = JSON.parse(toolCall.function.arguments);
            } catch {
                const msg = "I tried to call a tool but the arguments were too large or malformed to parse. Try using a shorter input (e.g. a URL instead of a base64 image).";
                history.push({ role: "assistant", content: msg });
                break;
            }

            const toolResponse = await callTool(req.body.sessionId, toolName, args);
            const limited = Array.isArray(toolResponse) && toolResponse.length > 100
                ? toolResponse.slice(0, 100)
                : toolResponse;

            history.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(limited)
            });

            console.log(`[Step ${iterations}] Tool: ${toolName} | Tokens so far: ${totalTokens}`);
        }

        // Hit a limit — tell the user why it stopped
        if (iterations >= MAX_ITERATIONS) {
            const msg = `I reached my step limit (${MAX_ITERATIONS} attempts) without completing the task. Try breaking it into smaller steps.`;
            history.push({ role: "assistant", content: msg });
        } else if (totalTokens >= TOKEN_BUDGET) {
            const msg = `I used too many tokens (${totalTokens}) and had to stop. The conversation is getting too long — try starting a new one.`;
            history.push({ role: "assistant", content: msg });
        }
    } catch (err: any) {
        console.error("Chat handler error:", err.message);
        const msg = `Something went wrong: ${err.message}`;
        history.push({ role: "assistant", content: msg });
    }

    res.json({ reply: history[history.length - 1].content, history })
})



app.listen(8000, () => {
    console.log("api server running on port 8000")
})