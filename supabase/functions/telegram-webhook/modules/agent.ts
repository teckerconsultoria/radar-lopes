// supabase/functions/telegram-webhook/modules/agent.ts
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BUSCAR_IMOVEIS_TOOL, buscarImoveis, buildSupabaseFilters, type ToolFilters } from "./search.ts";

const SYSTEM_PROMPT = `Você é o assistente de busca de imóveis da Lopes de Andrade Imóveis, especializado no mercado imobiliário de João Pessoa-PB.

Bairros disponíveis: Manaíra, Cabo Branco, Tambaú, Bessa, Altiplano, Miramar, Bancários, Água Fria, Jardim Oceania, Torre, Expedicionários, entre outros.
Tipos disponíveis: Apartamento, Casa, Terreno, Cobertura, Studio, Sala Comercial.
Características buscáveis: piscina, academia, churrasqueira, playground, portaria 24h, salão de festas, pet-friendly, varanda gourmet.

Comportamento:
- Aceite mensagens livres e extraia filtros implícitos. Use a ferramenta buscar_imoveis sempre que houver critérios suficientes.
- Só pergunte antes de buscar se a mensagem for muito genérica (ex: "quero um imóvel" sem nenhum critério).
- Após busca com muitos resultados (>8) ou nenhum resultado, sugira 1-2 perguntas de refinamento.
- Responda em português brasileiro, tom amigável e profissional.
- Antes de enviar os imóveis, informe quantos foram encontrados.`;

// ── Helpers exportados (testáveis sem Supabase/Anthropic) ─────────────────────

export function trimHistory(messages: unknown[]): unknown[] {
  return messages.slice(-20);
}

export function extractToolInput(
  content: Array<{ type: string; input?: unknown }>,
): ToolFilters | null {
  const block = content.find((b) => b.type === "tool_use");
  return block ? (block.input as ToolFilters) : null;
}

// ── Função principal ──────────────────────────────────────────────────────────

export async function processMessage(
  chatId: number,
  userText: string,
  anthropicKey: string,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<{ texto: string; imoveis: Record<string, unknown>[]; total: number; filters: ToolFilters | null }> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  // Carregar histórico
  const { data: conv } = await supabase
    .from("conversations")
    .select("messages, filters")
    .eq("chat_id", chatId)
    .maybeSingle();

  const history: unknown[] = trimHistory((conv?.messages as unknown[]) ?? []);
  const lastFilters: ToolFilters | null = conv?.filters ?? null;

  // Adicionar mensagem do usuário
  const messages = [...history, { role: "user", content: userText }];

  // Primeira chamada ao Claude
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [BUSCAR_IMOVEIS_TOOL],
    messages: messages as Anthropic.MessageParam[],
  });

  let finalText = "";
  let imoveis: Record<string, unknown>[] = [];
  let total = 0;
  let activeFilters: ToolFilters | null = lastFilters;

  if (response.stop_reason === "tool_use") {
    // Claude quer buscar imóveis
    const toolInput = extractToolInput(
      response.content as Array<{ type: string; input?: unknown }>
    );

    if (toolInput) {
      activeFilters = toolInput;
      const supabaseFilters = buildSupabaseFilters(toolInput);
      const result = await buscarImoveis(supabaseFilters, supabaseUrl, supabaseKey);
      imoveis = result.data;
      total = result.count;

      // Segunda chamada com resultado do tool
      const followUp = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        tools: [BUSCAR_IMOVEIS_TOOL],
        messages: [
          ...messages,
          { role: "assistant", content: response.content },
          {
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: (response.content.find((b: { type: string }) => b.type === "tool_use") as { id: string }).id,
              content: JSON.stringify({ total, sample: imoveis.slice(0, 3).map((i) => ({ titulo: i.titulo, bairro: i.bairro, preco: i.preco })) }),
            }],
          },
        ] as Anthropic.MessageParam[],
      });

      finalText = (followUp.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "";
    }
  } else {
    // Claude respondeu diretamente (pergunta de refinamento)
    finalText = (response.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "";
  }

  // Salvar histórico atualizado (sliding window 20)
  const updatedMessages = trimHistory([
    ...messages,
    { role: "assistant", content: finalText || response.content },
  ]);

  await supabase.from("conversations").upsert(
    { chat_id: chatId, messages: updatedMessages, filters: activeFilters, updated_at: new Date().toISOString() },
    { onConflict: "chat_id" },
  );

  return { texto: finalText, imoveis, total, filters: activeFilters };
}
