//import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import dotenv from "dotenv"
dotenv.config();
export async function initializeAgent(): Promise<string>{
    //make curl command as a responce
    const response = await fetch("http://localhost:3000/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream"
    },
    body: JSON.stringify({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": { "name": "test-client", "version": "1.0.0" }
        }      
    })
    });

    const sessionId = response.headers.get("mcp-session-id");
    if (!sessionId) throw new Error("No session ID returned");
    return sessionId;
}

export async function getTools(sessionId: string): Promise<any[]>{
    const response = await fetch("http://localhost:3000/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "mcp-session-id": sessionId
    },
    body: JSON.stringify({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/list",
        "params": {}      
    })
    });

    const text = await response.text();
    //turn into text
    const data = JSON.parse(text.split("\n").find(line => line.startsWith("data: "))!.slice(6));
    if (!data.result.tools) throw new Error("No tools list returned");
    return data.result.tools;
}
/*
//curl -v -X POST http://localhost:3000/mcp -H "Content-Type: application/json" -H 
// "Accept: application/json, text/event-stream" -H "mcp-session-id: SESSION_ID" -d 
// "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"get_post\",\
// "arguments\":{\"id\":1}}}"

*/
export async function callTool(sessionId: string, toolName: string, args: Record<string, any>): Promise<any[]> {
    const response = await fetch("http://localhost:3000/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "mcp-session-id": sessionId
    },
    body: JSON.stringify({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
        "name": toolName,
        "arguments": args
        }      
    })
    });

    const text = await response.text();
    const data = JSON.parse(text.split("\n").find(line => line.startsWith("data: "))!.slice(6));
    if (!data.result.content) throw new Error("Tool call failed");
    return data.result.content;
}

export async function messageAI(messageHistory: OpenAI.Chat.ChatCompletionMessageParam[], tools: any[]) {
    //const client = new Anthropic({ apiKey: process.env.SANDBOX_OPENAI_KEY});
    const client = new OpenAI({ apiKey:process.env.SANDBOX_OPENAI_KEY });
    //const response = await client.messages.create({
    const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 4096,
    messages: messageHistory,
    tools: tools
    })
    
    if (!response) throw new Error("No tools list returned");
    return response.choices[0].message;
}
