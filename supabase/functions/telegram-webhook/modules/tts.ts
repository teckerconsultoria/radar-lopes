// supabase/functions/telegram-webhook/modules/tts.ts

const OPENAI_TTS_API = "https://api.openai.com/v1/audio/speech";

export async function textToSpeech(
  text: string,
  apiKey: string,
  voice = "nova",
): Promise<Uint8Array> {
  const res = await fetch(OPENAI_TTS_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      input: text,
      voice,
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`OpenAI TTS error ${res.status}:`, body);
    throw new Error(`OpenAI TTS ${res.status}: ${body}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
