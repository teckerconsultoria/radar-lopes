import { useState, useCallback } from "react";
import { sendMessage } from "../lib/chat";

function getOrCreateSessionId() {
  const key = "radar_lopes_session_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(getOrCreateSessionId);

  const send = useCallback(async (text) => {
    if (!text.trim() || loading) return;

    const userMsg = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const data = await sendMessage(text, sessionId);
      const agentMsg = {
        role: "assistant",
        content: data.response ?? "",
        imoveis: data.imoveis ?? [],
        total: data.total ?? 0,
      };
      setMessages((prev) => [...prev, agentMsg]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Erro ao processar sua mensagem. Tente novamente.", imoveis: [], total: 0, isError: true },
      ]);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [sessionId, loading]);

  const reset = useCallback(() => {
    const newId = crypto.randomUUID();
    localStorage.setItem("radar_lopes_session_id", newId);
    setSessionId(newId);
    setMessages([]);
  }, []);

  return { messages, loading, send, reset };
}
