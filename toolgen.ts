import SwaggerParser from "@apidevtools/swagger-parser"
import { writeFileSync } from "fs"
import { ToolsFile, EndpointDefinition } from "./server.js"

//async functions are for the await method, making sure it doesnt keep going forward until await is completed.
async function parseSpec(specUrl: string): Promise<ToolsFile> {
    //Uses the specURL and calls the ts function SwaggerParser that downloads and reads the file. The any lets us use any format telling the compiler we know what were doing, we might have to switch  that later on
    const api = await SwaggerParser.parse(specUrl) as any
    //check  if the baseURL is present, if not it makes sure it doesnt throw an error
    /*
    1. api.servers?. — if api.servers is undefined, stop here and return undefined instead of crashing
    2. [0]?. — if the array exists but is empty, stop here and return undefined instead of crashing
    3. .url — get the url property
    4. ?? "" — if anything above produced undefined, use "" instead
    */
    const baseUrl = api.servers?.[0]?.url ?? new URL(specUrl).origin

    //initialize a tools array
    const tools: EndpointDefinition[] = []

    //looks at all the paths(the individual endpoints)
    for (const path in api.paths) {
        //create a path object that will hold everything needed for a tool
        const pathItem = api.paths[path]
        //loops through each method (post, put, get, delete...)
        for (const method in pathItem) {
            //if the key is not one of the specified below skip it, it would break our code
            if (!["get", "post", "put", "delete", "patch"].includes(method)) continue
            
            //which ever method you took in (get, post, ...) you add the contents of the whole obj {} into this operation obj
            const operation = pathItem[method]
            //makes an array of ("parameters" which is also an arr) from the operation obj we just created above
            const parameters = operation.parameters ?? []
            //from the method we took in (get, post, ...) concantinate that with _ and the path name we choose at the very beginning, the entire path obj, this gives us a name for our tool, in a reproducible way
            /*
            1. /\//g — replaces all / with _ → _pet_{petId}
            2. /^_/ — removes the leading _ at the start → pet_{petId}
            3. /[{}]/g — removes all { and } → pet_petId
            */
            const name = method + "_" + path.replace(/\//g, "_").replace(/^_/, "").replace(/[{}]/g, "")

            //initialises an empty object with the types (type which is a string, and description which is also a string)
            //Empty object to store each parameter's name, type, and description
            //Record is just TypeScript making sure every entry follows that shape.
            const properties: Record<string, { type: string, description: string }> = {}

            
            const required: string[] = []
            const query_params: string[] = []

            for (const param of parameters) {
                properties[param.name] = {
                    type: param.schema?.type ?? "string",
                    description: param.description ?? param.name
                }
                if (param.required) required.push(param.name)
                if (param.in === "query") query_params.push(param.name)
            }

            const tool: EndpointDefinition = {
                name,
                description: operation.summary ?? operation.description ?? name,
                input_schema: {
                    type: "object",
                    properties,
                    required
                },
                handler: {
                    method: method.toUpperCase(),
                    path,
                    headers: {},
                    query_params
                }
            }

            tools.push(tool)
        }
    }

    return { baseUrl, tools }
}

const specUrl = process.argv[2]
if (!specUrl) {
    console.error("Usage: npx tsx toolgen.ts <spec-url>")
    process.exit(1)
}

parseSpec(specUrl).then(result => {
    writeFileSync("tools.json", JSON.stringify(result, null, 2))
    console.log(`Generated ${result.tools.length} tools → tools.json`)
}).catch(err => {
    console.error("Failed:", err.message)
    process.exit(1)
})
