// supabase/functions/telegram-webhook/modules/transcription.ts

const GROQ_API = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_API = "https://api.openai.com/v1/audio/transcriptions";

export async function transcribeVoice(
  audioUrl: string,
  apiKey: string,
  provider: "groq" | "openai" = "groq",
): Promise<string> {
  // Baixar arquivo OGG do Telegram
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`Falha ao baixar áudio: ${audioRes.status}`);
  const audioBlob = await audioRes.blob();
  if (audioBlob.size > 25_000_000) {
    throw new Error("Áudio muito longo. Por favor, envie uma mensagem de voz mais curta.");
  }

  // Montar form data para Whisper
  const formData = new FormData();
  formData.append("file", new File([audioBlob], "audio.ogg", { type: "audio/ogg" }));
  formData.append("model", provider === "groq" ? "whisper-large-v3-turbo" : "whisper-1");
  formData.append("language", "pt");
  formData.append("response_format", "text");

  const endpoint = provider === "groq" ? GROQ_API : OPENAI_API;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper error (${provider}): ${err}`);
  }

  return (await res.text()).trim();
}
