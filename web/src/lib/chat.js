const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export async function sendMessage(message, sessionId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/web-agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ message, sessionId }),
  });

  if (!res.ok) {
    throw new Error(`Erro ${res.status}: ${await res.text()}`);
  }

  return res.json(); // { response: string, imoveis: [], total: number }
}
