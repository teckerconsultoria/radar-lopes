// supabase/functions/web-agent/agent.ts
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BUSCAR_IMOVEIS_TOOL, buscarImoveis, buildSupabaseFilters, type ToolFilters } from "./search.ts";

const PROMPT_VERSION = "v6-web";

const SYSTEM_PROMPT = `Você é um assistente de busca de imóveis da Lopes de Andrade Imóveis. Você interage com corretores da imobiliária — não com clientes finais. Seja objetivo, preciso e técnico. Sem excessos de emojis ou linguagem comercial.

Bairros disponíveis no sistema (use exatamente esses nomes): Bancarios, Mangabeira, Jardim Cidade Universitaria, Geisel, Cristo Redentor, Planalto Da Boa Esperanca, Manaira, Mucumagro, Valentina, Paratibe, Portal Do Sol, Gramame, Torre, Jardim Sao Paulo, Jose Americo, Aeroclube, Altiplano, Jardim Oceania, Tambau, Agua Fria, Centro, Jaguaribe, Colibris, Cuia, Industrias.
Tipos disponíveis: Apartamento, Casa, Terreno, Cobertura, Studio, Sala Comercial.
Características buscáveis: piscina, academia, churrasqueira, playground, portaria 24h, salão de festas, pet-friendly, varanda gourmet, mobiliado.

Regras de busca:
- SEMPRE infira e passe o campo modalidade: "comprar/à venda/venda" → "venda"; "alugar/aluguel/locação" → "aluguel". Se ambíguo, pergunte.
- Use buscar_imoveis sempre que houver critérios suficientes. Só pergunte antes se a mensagem for completamente vaga (sem tipo, bairro, preço ou modalidade).
- NUNCA amplie filtros automaticamente. Se não houver resultados, informe claramente o que não foi encontrado e pergunte ao corretor qual critério ele quer relaxar.
- NUNCA sugira bairros, preços ou alternativas sem antes verificar no sistema com buscar_imoveis.

Regras de resposta:
- Quando a busca retornar resultados, responda com UMA FRASE CURTA apenas (ex: "Encontrei 3 apartamentos nos Bancários."). Os cards são exibidos automaticamente — não liste imóveis em texto.
- IMPORTANTE: Perguntas de follow-up sobre resultados já exibidos (ex: "todos têm suíte?", "qual o maior?", "têm garagem?", "é mobiliado?", "qual estado do imóvel?") devem ser respondidas em texto usando os dados da amostra já disponível no contexto (campos: detalhes, caracteristicas, pois, suites, garagem, area_m2, mobiliado, andar, etc.). NÃO chame buscar_imoveis novamente para essas perguntas — os cards já foram exibidos e não devem ser reenviados.
- Quando não houver resultados, informe diretamente: "Nenhum resultado para [critérios]. Qual filtro deseja ajustar?"
- Quando o corretor confirmar que quer ver os imóveis (ex: "sim", "quero ver", "mostra"), chame buscar_imoveis com os mesmos filtros da busca anterior.
- Responda em português brasileiro, tom direto e profissional.`;

function trimHistory(messages: unknown[]): unknown[] {
  return messages.slice(-20);
}

export async function processMessage(
  sessionId: string,
  userText: string,
  anthropicKey: string,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<{ texto: string; imoveis: Record<string, unknown>[]; total: number }> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  // Carregar histórico da sessão web
  const { data: conv } = await supabase
    .from("web_conversations")
    .select("messages, filters, prompt_version")
    .eq("session_id", sessionId)
    .maybeSingle();

  const promptIsStale = conv?.prompt_version !== PROMPT_VERSION;
  const history: unknown[] = promptIsStale ? [] : trimHistory((conv?.messages as unknown[]) ?? []);
  const lastFilters: ToolFilters | null = promptIsStale ? null : (conv?.filters ?? null);

  const messages = [...history, { role: "user", content: userText }];

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
    const allToolUseBlocks = (response.content as Array<{ type: string; id?: string; input?: unknown }>)
      .filter((b) => b.type === "tool_use") as Array<{ id: string; type: string; input: unknown }>;

    const toolUseBlock = allToolUseBlocks[0];
    const toolInput = toolUseBlock ? (toolUseBlock.input as ToolFilters) : null;

    if (toolInput && toolUseBlock) {
      activeFilters = toolInput;
      const supabaseFilters = buildSupabaseFilters(toolInput);
      const result = await buscarImoveis(supabaseFilters, supabaseUrl, supabaseKey);
      imoveis = result.data;
      total = result.count;

      const toolResults = allToolUseBlocks.map((block, idx) => ({
        type: "tool_result" as const,
        tool_use_id: block.id,
        content: idx === 0
          ? JSON.stringify({ total, sample: imoveis.slice(0, 5).map((i) => ({
              titulo:          i.titulo,
              bairro:          i.bairro,
              preco:           i.preco,
              area_m2:         i.area_m2,
              quartos:         i.quartos,
              suites:          i.suites,
              banheiros:       i.banheiros,
              garagem:         i.garagem,
              andar:           i.andar,
              eh_terreo:       i.eh_terreo,
              mobiliado:       i.mobiliado,
              caracteristicas: i.caracteristicas,
              pois:            i.pois,
              detalhes:        i.detalhes_imovel,
            })) })
          : JSON.stringify({ total: 0, sample: [] }),
      }));

      const followUp = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        tools: [BUSCAR_IMOVEIS_TOOL],
        messages: [
          ...messages,
          { role: "assistant", content: response.content },
          { role: "user", content: toolResults },
        ] as Anthropic.MessageParam[],
      });

      finalText = (followUp.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "";
      if (!finalText) {
        finalText = `Encontrei ${total} imóvel${total !== 1 ? "is" : ""} com esses critérios.`;
      }
    }
  } else {
    finalText = (response.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "";
  }

  // Salvar histórico atualizado
  const assistantMessage = { role: "assistant", content: finalText || "Aqui estão os imóveis encontrados." };
  const updatedMessages = trimHistory([...messages, assistantMessage]);

  await supabase.from("web_conversations").upsert(
    { session_id: sessionId, messages: updatedMessages, filters: activeFilters, prompt_version: PROMPT_VERSION, updated_at: new Date().toISOString() },
    { onConflict: "session_id" },
  );

  return { texto: finalText, imoveis, total };
}
