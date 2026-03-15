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
- REGRA CRÍTICA: NUNCA sugira bairros, faixas de preço ou tipos de imóvel sem primeiro usar buscar_imoveis para verificar se existem resultados. Toda sugestão deve ser baseada em dados reais do sistema.
- Quando não encontrar resultados com os filtros atuais, use buscar_imoveis novamente com filtros mais amplos (ex: remover bairro, aumentar preço, remover filtro de térreo) antes de sugerir alternativas.
- Quando a busca retornar resultados, responda com APENAS UMA FRASE CURTA de introdução (ex: "Encontrei 6 casas até R$ 220.000! Confira abaixo 👇"). NÃO liste os imóveis em texto — eles serão enviados automaticamente como cards individuais com foto, preço e botões.
- Após busca com muitos resultados (>8), sugira 1-2 perguntas de refinamento após a frase de introdução.
- Responda em português brasileiro, tom amigável e profissional.`;

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
      // Extract tool_use block id safely
      const toolUseBlock = response.content.find(
        (b: { type: string }) => b.type === "tool_use"
      ) as { id: string; type: string } | undefined;
      if (!toolUseBlock) {
        return { texto: "", imoveis: [], total: 0, filters: lastFilters };
      }

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
              tool_use_id: toolUseBlock.id,
              content: JSON.stringify({ total, sample: imoveis.slice(0, 3).map((i) => ({ titulo: i.titulo, bairro: i.bairro, preco: i.preco })) }),
            }],
          },
        ] as Anthropic.MessageParam[],
      });

      finalText = (followUp.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "";
      if (!finalText) {
        finalText = `Encontrei ${total} imóvel${total !== 1 ? "is" : ""} com esses critérios.`;
      }
    }
  } else {
    // Claude respondeu diretamente (pergunta de refinamento)
    finalText = (response.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "";
  }

  // Salvar histórico atualizado (sliding window 20)
  let assistantMessage: { role: string; content: unknown };
  if (response.stop_reason === "tool_use" && finalText) {
    // No branch tool_use: salvar a resposta final em texto
    assistantMessage = { role: "assistant", content: finalText };
  } else if (response.stop_reason !== "tool_use") {
    // Resposta direta do Claude
    assistantMessage = { role: "assistant", content: finalText };
  } else {
    // Fallback: ferramenta usada mas sem texto de resposta
    assistantMessage = { role: "assistant", content: "Aqui estão os imóveis encontrados." };
  }

  const updatedMessages = trimHistory([...messages, assistantMessage]);

  await supabase.from("conversations").upsert(
    { chat_id: chatId, messages: updatedMessages, filters: activeFilters, updated_at: new Date().toISOString() },
    { onConflict: "chat_id" },
  );

  return { texto: finalText, imoveis, total, filters: activeFilters };
}
