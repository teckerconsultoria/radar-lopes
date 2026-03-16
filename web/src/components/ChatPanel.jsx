import { useRef, useEffect, useState } from "react";
import { useChat } from "../hooks/useChat";
import ImovelCard from "./ImovelCard";

const EXEMPLOS = [
  "Apto 3 quartos em Manaíra para venda",
  "Casas até R$ 500k em Mangabeira",
  "Aluguel de apartamento com piscina em Tambaú",
  "Cobertura com suíte no Aeroclube",
];

function LoadingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
    </div>
  );
}

function UserBubble({ content }) {
  return (
    <div className="flex justify-end mb-4">
      <div className="bg-brand-700 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[80%] text-sm leading-relaxed">
        {content}
      </div>
    </div>
  );
}

function AgentMessage({ content, imoveis, total, isError }) {
  return (
    <div className="mb-4">
      {/* Texto da resposta */}
      {content && (
        <div className={`flex items-start gap-2 mb-3`}>
          <div className="w-7 h-7 rounded-full bg-brand-900 flex items-center justify-center shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div className={`rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed max-w-[80%]
            ${isError ? "bg-red-50 text-red-700 border border-red-200" : "bg-white border border-gray-200 text-gray-800 shadow-sm"}`}>
            {content}
          </div>
        </div>
      )}

      {/* Cards de imóveis */}
      {imoveis && imoveis.length > 0 && (
        <div className="ml-9">
          {total > imoveis.length && (
            <p className="text-xs text-gray-500 mb-2">
              Exibindo {imoveis.length} de {total} imóveis encontrados
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {imoveis.slice(0, 9).map((imovel) => (
              <ImovelCard key={imovel.id ?? imovel.url} imovel={imovel} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ChatPanel() {
  const { messages, loading, send, reset } = useChat();
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function handleSubmit(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    send(text);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Área de mensagens */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-4xl mx-auto">
          {isEmpty && !loading && (
            <div className="text-center py-16">
              <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-brand-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-700 mb-1">Busca por conversa</h2>
              <p className="text-sm text-gray-500 mb-6">Descreva o imóvel que procura em linguagem natural.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {EXEMPLOS.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => send(ex)}
                    className="text-xs bg-white border border-gray-200 rounded-full px-3 py-1.5
                               text-gray-600 hover:border-brand-400 hover:text-brand-700
                               transition-colors shadow-sm"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) =>
            msg.role === "user"
              ? <UserBubble key={i} content={msg.content} />
              : <AgentMessage key={i} content={msg.content} imoveis={msg.imoveis} total={msg.total} isError={msg.isError} />
          )}

          {loading && (
            <div className="flex items-start gap-2 mb-4">
              <div className="w-7 h-7 rounded-full bg-brand-900 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm shadow-sm">
                <LoadingDots />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ex: apartamento 3 quartos em Manaíra até R$ 600 mil para venda..."
              rows={1}
              disabled={loading}
              className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
                         disabled:bg-gray-50 disabled:text-gray-400
                         max-h-32 overflow-y-auto"
              style={{ lineHeight: "1.5" }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="btn-primary px-3 py-2.5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>
          <p className="text-xs text-gray-400 mt-1.5 text-center">
            Enter para enviar · Shift+Enter para nova linha
            {messages.length > 0 && (
              <button onClick={reset} className="ml-3 underline hover:text-gray-600">
                Nova conversa
              </button>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
