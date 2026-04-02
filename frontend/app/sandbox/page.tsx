"use client"
import { useState, useEffect, useRef } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Send, User, Bot } from "lucide-react"
import Image from "next/image"
import Link from "next/link"

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ")

interface Message {
  id: string
  role: "user" | "assistant" | "tool_call"
  content: string  // for tool_call: the tool name
  timestamp: Date
}

interface Tool {
  type: string
  function: {
    name: string
    description: string
    parameters: unknown
  }
  handler?: {
    method: string
    path: string
    query_params?: string[]
  }
  enabled?: boolean
}

const METHOD_STYLES: Record<string, string> = {
  GET:    "border border-gray-300 text-gray-500 bg-white",
  POST:   "bg-gray-800 text-white",
  PUT:    "bg-gray-600 text-white",
  PATCH:  "bg-gray-500 text-white",
  DELETE: "bg-black text-white",
}

export default function Sandbox() {
  const searchParams = useSearchParams()
  const specId      = searchParams.get("specId")
  const compositeId = searchParams.get("compositeId")
  const router = useRouter()

  // sandbox state
  const [sessionId, setSessionId] = useState("")
  const [allTools, setAllTools] = useState<Tool[]>([])
  const [toolToggles, setToolToggles] = useState<Record<string, boolean>>({})
  const [activeTools, setActiveTools] = useState<Tool[]>([])

  // chat UI state
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // initialize sandbox on page load
  useEffect(() => {
    // Composite path — re-initialize the MCP session on every page load.
    // sessionStorage holds the tools but NOT a reusable session — server.ts sessions
    // are in-memory only and are lost on restart, so we always start fresh here.
    if (compositeId) {
      const raw = sessionStorage.getItem(`helios_session_${compositeId}`)
      if (!raw) return
      const { tools } = JSON.parse(raw)
      const toolList: Tool[] = tools ?? []

      const registryTools = toolList.map((t: Tool) => ({
        name:         t.function.name,
        description:  t.function.description,
        input_schema: t.function.parameters ?? { type: "object", properties: {} },
        handler: {
          method:       t.handler?.method ?? "GET",
          path:         t.handler?.path ?? "",
          headers:      {},
          query_params: t.handler?.query_params ?? []
        }
      }))

      fetch("http://localhost:8000/api/sandbox/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolsRegistry: { baseUrl: "", tools: registryTools } })
      })
        .then(res => res.json())
        .then(data => {
          // Update sessionStorage with the new sessionId for this page load
          sessionStorage.setItem(`helios_session_${compositeId}`, JSON.stringify({ sessionId: data.sessionId, tools: toolList }))
          setSessionId(data.sessionId)
          setAllTools(toolList)
          setActiveTools(toolList.filter((t: Tool) => t.enabled !== false))
          const initialToggles: Record<string, boolean> = {}
          toolList.forEach((t: Tool) => { initialToggles[t.function.name] = t.enabled ?? true })
          setToolToggles(initialToggles)
        })
      return
    }

    // Standard path — spec-based initialization
    const draft = specId ? sessionStorage.getItem(`helios_draft_${specId}`) : null
    const draftData = draft ? JSON.parse(draft) : null

    fetch("http://localhost:8000/api/sandbox/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ specId, spec: draftData?.spec ?? undefined, baseUrl: draftData?.baseUrl ?? undefined })
    })
      .then(res => res.json())
      .then(data => {
        const tools: Tool[] = data.tools ?? []
        setSessionId(data.sessionId)
        setAllTools(tools)
        setActiveTools(tools.filter(t => t.enabled !== false))
        const initialToggles: Record<string, boolean> = {}
        tools.forEach((t: Tool) => { initialToggles[t.function.name] = t.enabled ?? true })
        setToolToggles(initialToggles)
      })
  }, [specId, compositeId])

  // scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px"
    }
  }, [input])

  const toggleTool = (name: string) => {
    setToolToggles(prev => ({ ...prev, [name]: !prev[name] }))
  }

  // Applying a new tool set resets chat — the old history references tools that may no longer be active.
  const handleApply = () => {
    const filtered = allTools.filter(t => toolToggles[t.function.name])
    setActiveTools(filtered)
    setMessages([])
  }

  const handleNavigateToVerify = () => {
    if (compositeId) {
      // Composite session — pass compositeId so verify can read tools from sessionStorage
      router.push(`/verify?compositeId=${compositeId}`)
      return
    }
    if (specId) {
      const draft = sessionStorage.getItem(`helios_draft_${specId}`)
      if (draft) {
        // New server — update existing draft catalog with current toggle states
        const draftData = JSON.parse(draft)
        if (Array.isArray(draftData.catalog)) {
          const updatedCatalog = draftData.catalog.map((item: { name: string; enabled?: boolean }) => ({
            ...item,
            enabled: toolToggles[item.name] ?? item.enabled ?? true
          }))
          sessionStorage.setItem(`helios_draft_${specId}`, JSON.stringify({ ...draftData, catalog: updatedCatalog }))
        }
      } else {
        // Existing server — write toggle overrides so Verify can apply them on top of the DB catalog
        sessionStorage.setItem(`helios_toggles_${specId}`, JSON.stringify(toolToggles))
      }
      router.push(`/verify?specId=${specId}`)
    }
  }

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const messageText = input.trim()

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageText,
      timestamp: new Date()
    }
    setMessages(prev => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60000) // 1 min max

    fetch("http://localhost:8000/api/sandbox/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        tools: activeTools,
        // tool_call messages are UI-only; strip them before sending history to the backend
        history: messages.filter(m => m.role !== "tool_call").map(m => ({ role: m.role, content: m.content })),
        message: messageText
      }),
      signal: controller.signal
    })
      .then(res => res.json())
      .then(data => {
        clearTimeout(timeout)
        // Parse returned history to detect if a tool was called
        const history: { role: string; tool_calls?: { function: { name: string } }[] }[] = data.history ?? []
        const toolCallStep = history.find(m => m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0)
        const toolsUsed = toolCallStep?.tool_calls?.map(tc => tc.function?.name).filter(Boolean) ?? []

        const newMessages: Message[] = []
        if (toolsUsed.length > 0) {
          newMessages.push({
            id: Date.now().toString() + "-tool",
            role: "tool_call",
            content: toolsUsed.join("  ·  "),
            timestamp: new Date()
          })
        }
        newMessages.push({
          id: Date.now().toString(),
          role: "assistant",
          content: data.reply,
          timestamp: new Date()
        })
        setMessages(prev => [...prev, ...newMessages])
        setIsLoading(false)
      })
      .catch(err => {
        clearTimeout(timeout)
        const reason = err.name === "AbortError" ? "Request timed out — the AI took too long to respond." : "Failed to reach the server."
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: "assistant",
          content: reason,
          timestamp: new Date()
        }])
        setIsLoading(false)
      })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const enabledCount = Object.values(toolToggles).filter(Boolean).length

  return (
    <div className="flex flex-col h-screen w-full bg-white">

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 pl-20 flex-shrink-0">
        <Link href="/">
          <Image src="/logoName.svg" alt="Helios" width={200} height={200} className="cursor-pointer" />
        </Link>
        <div className="flex items-center gap-4 font-[family-name:--font-cinzel] text-[32px] tracking-widest">
          <span className="text-gray-400">Create</span>
          <span className="text-gray-400 text-[20px] mb-1">✦</span>
          <span className="flex flex-col items-center text-black">
            Sandbox
            <span className="block h-[2px] w-full bg-black mt-[-4px]"></span>
          </span>
          <span className="text-gray-400 text-[20px] mb-1">✦</span>
          <span onClick={handleNavigateToVerify} className="text-gray-400 hover:text-black transition-colors duration-200 cursor-pointer">Verify</span>
          <span className="text-gray-400 text-[20px] mb-1">✦</span>
          <span className="text-gray-400">Download</span>
        </div>
        <div className="flex items-center gap-3 w-[220px] justify-end">
          <Link href="/" className="font-[family-name:--font-cinzel] text-[14px] tracking-widest text-gray-400 border-[2px] border-gray-300 px-4 py-2 hover:border-black hover:text-black transition-colors duration-200">
            Cancel
          </Link>
          <button onClick={handleNavigateToVerify} className="font-[family-name:--font-cinzel] text-[14px] tracking-widest text-white bg-black border-[2px] border-black px-4 py-2 hover:bg-white hover:text-black transition-colors duration-200 cursor-pointer">
            Next →
          </button>
        </div>
      </nav>

      {/* Body — two panels */}
      <div className="flex flex-1 overflow-hidden border-t-[2px] border-black">

        {/* Chat — left */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="max-w-2xl mx-auto space-y-6">
              {messages.map((message) => {
                // Tool call indicator — centered divider row
                if (message.role === "tool_call") {
                  return (
                    <div key={message.id} className="flex items-center gap-3 py-1">
                      <div className="flex-1 h-[1px] bg-gray-200"></div>
                      <div className="flex items-center gap-2">
                        {/* Hammer & anvil animation */}
                        <svg viewBox="0 0 64 68" width="22" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" className="text-gray-400 flex-shrink-0">
                          <g>
                            <rect x="18" y="2" width="28" height="12" />
                            <rect x="30" y="14" width="4" height="18" />
                          </g>
                          <rect x="10" y="42" width="44" height="10" />
                          <rect x="16" y="52" width="32" height="8" />
                          <rect x="10" y="60" width="44" height="6" />
                          <path d="M10 42 L3 47 L10 52" />
                        </svg>
                        <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-gray-400 whitespace-nowrap">
                          {message.content}
                        </span>
                      </div>
                      <div className="flex-1 h-[1px] bg-gray-200"></div>
                    </div>
                  )
                }

                return (
                  <div
                    key={message.id}
                    className={cn(
                      "flex gap-4",
                      message.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    {message.role === "assistant" && (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-black flex items-center justify-center">
                        <Bot className="w-5 h-5 text-white" />
                      </div>
                    )}
                    <div
                      className={cn(
                        "max-w-[70%] px-4 py-3",
                        message.role === "user"
                          ? "bg-black text-white"
                          : "border-[1px] border-gray-300 text-black"
                      )}
                    >
                      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words font-[family-name:--font-geist-sans]">
                        {message.content}
                      </p>
                    </div>
                    {message.role === "user" && (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full border-[2px] border-black flex items-center justify-center">
                        <User className="w-5 h-5 text-black" />
                      </div>
                    )}
                  </div>
                )
              })}

              {isLoading && (
                <div className="flex gap-4 justify-start">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-black flex items-center justify-center">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                  <div className="border-[1px] border-gray-300 px-4 py-3 flex items-center gap-3">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-black/40 animate-bounce [animation-delay:0ms]" />
                      <div className="w-2 h-2 rounded-full bg-black/40 animate-bounce [animation-delay:150ms]" />
                      <div className="w-2 h-2 rounded-full bg-black/40 animate-bounce [animation-delay:300ms]" />
                    </div>
                    <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-gray-400">Thinking...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input */}
          <div className="border-t-[1px] border-gray-300 bg-white">
            <div className="max-w-2xl mx-auto px-4 py-4">
              <div className="relative flex items-end gap-2 border-[2px] border-gray-300 bg-white p-2 focus-within:border-black transition-colors duration-200">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Test your tools..."
                  rows={1}
                  className="flex-1 resize-none bg-transparent px-3 py-2 text-sm font-[family-name:--font-geist-sans] placeholder:text-gray-400 focus:outline-none min-h-[40px] max-h-[200px]"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  aria-label="Send message"
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className={cn(
                    "flex-shrink-0 p-2 transition-colors",
                    input.trim() && !isLoading
                      ? "bg-black text-white hover:bg-gray-800"
                      : "bg-gray-100 text-gray-400 cursor-not-allowed"
                  )}
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Tool Catalog — right */}
        <div className="w-[380px] border-l-[2px] border-black flex flex-col flex-shrink-0">

          {/* Header */}
          <div className="px-6 py-4 flex items-baseline justify-between flex-shrink-0">
            <span className="font-[family-name:--font-cinzel] text-[22px] tracking-widest">Tool Catalog</span>
            <span className="font-[family-name:--font-cinzel] text-[14px] text-gray-400 tracking-widest">
              {enabledCount} / {allTools?.length ?? 0}
            </span>
          </div>
          <div className="h-[2px] bg-black flex-shrink-0"></div>

          {/* Tool list */}
          <div className="flex-1 overflow-y-auto">
            {allTools.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <span className="font-[family-name:--font-cinzel] text-gray-400 text-[14px] tracking-widest">Loading tools...</span>
              </div>
            ) : (
              allTools.map((tool, i) => {
                const enabled = toolToggles[tool.function.name] ?? true
                return (
                  <div
                    key={tool.function.name}
                    className={cn(
                      "flex items-start gap-4 px-6 py-4 cursor-pointer transition-colors duration-150",
                      i !== allTools.length - 1 && "border-b-[1px] border-gray-200",
                      enabled ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100"
                    )}
                    onClick={() => toggleTool(tool.function.name)}
                  >
                    {/* Toggle box */}
                    <div className={cn(
                      "flex-shrink-0 w-5 h-5 border-[2px] mt-0.5 flex items-center justify-center transition-colors duration-150",
                      enabled ? "border-black bg-black" : "border-gray-400 bg-white"
                    )}>
                      {enabled && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path d="M1 3.5L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>

                    {/* Tool info */}
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {tool.handler?.method && (
                          <span className={cn(
                            "flex-shrink-0 font-[family-name:--font-geist-mono] text-[9px] tracking-widest px-1.5 py-0.5",
                            enabled
                              ? (METHOD_STYLES[tool.handler.method.toUpperCase()] ?? "bg-gray-400 text-white")
                              : "border border-gray-200 text-gray-300 bg-white"
                          )}>
                            {tool.handler.method.toUpperCase()}
                          </span>
                        )}
                        <span className={cn(
                          "font-[family-name:--font-cinzel] text-[13px] tracking-wider leading-tight truncate",
                          enabled ? "text-black" : "text-gray-400"
                        )}>
                          {tool.function.name}
                        </span>
                      </div>
                      {tool.function.description && (
                        <span className="text-[11px] text-gray-400 leading-snug font-[family-name:--font-geist-sans] truncate">
                          {tool.function.description}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Footer buttons */}
          <div className="border-t-[2px] border-black p-6 flex-shrink-0">
            <button
              onClick={handleApply}
              className="font-[family-name:--font-cinzel] w-full cursor-pointer py-4 text-[16px] tracking-widest text-black border-[2px] border-black relative
                before:absolute before:inset-[4px] before:border-[1px] before:border-black before:pointer-events-none
                hover:bg-black hover:text-white hover:before:border-white transition-colors duration-300"
            >
              Apply & Reset Chat
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
