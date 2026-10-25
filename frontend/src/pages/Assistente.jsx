import { useRef, useState } from "react";
import api, { apiError } from "@/lib/api";
import { Btn, Spinner } from "@/components/kit";
import { Bot, Send, User } from "lucide-react";

export default function Assistente() {
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Olá! Sou o assistente do Shopping Hospitalar. Como posso ajudar com vendas, DAVs ou estoque?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  const send = async (e) => {
    e.preventDefault();
    const msg = input.trim();
    if (!msg || loading) return;
    setMessages((m) => [...m, { role: "user", text: msg }]);
    setInput(""); setLoading(true);
    try {
      const { data } = await api.post("/ai/chat", { message: msg });
      setMessages((m) => [...m, { role: "assistant", text: data.reply }]);
    } catch (e2) {
      setMessages((m) => [...m, { role: "assistant", text: apiError(e2.response?.data?.detail), error: true }]);
    } finally {
      setLoading(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] lg:h-[calc(100vh-5rem)]" data-testid="assistente-page">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl grid place-items-center neon-ring bg-primary/10"><Bot className="w-5 h-5 text-primary" /></div>
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold">Assistente IA</h1>
          <p className="text-xs text-muted-foreground">Powered by ChatGPT (OpenAI)</p>
        </div>
      </div>

      <div className="glass card-panel flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`} data-testid={`msg-${m.role}`}>
            <div className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${m.role === "user" ? "bg-secondary" : "bg-primary/15"}`}>
              {m.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-primary" />}
            </div>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary/15" : m.error ? "bg-rose-500/15 text-rose-200" : "bg-secondary"}`}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && <div className="flex gap-3"><div className="w-8 h-8 rounded-lg grid place-items-center bg-primary/15"><Bot className="w-4 h-4 text-primary" /></div><div className="bg-secondary rounded-2xl px-4 py-3"><Spinner className="w-4 h-4 text-primary" /></div></div>}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="flex gap-2 mt-4">
        <input className="field flex-1" placeholder="Digite sua mensagem..." value={input} onChange={(e) => setInput(e.target.value)} data-testid="ai-input" />
        <Btn type="submit" disabled={loading} data-testid="ai-send"><Send className="w-4 h-4" /></Btn>
      </form>
    </div>
  );
}
