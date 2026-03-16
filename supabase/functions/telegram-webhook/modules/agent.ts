// supabase/functions/telegram-webhook/modules/agent.ts
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BUSCAR_IMOVEIS_TOOL, buscarImoveis, buildSupabaseFilters, type ToolFilters } from "./search.ts";

// Incrementar sempre que o SYSTEM_PROMPT mudar — invalida históricos antigos automaticamente
const PROMPT_VERSION = "v7";

const SYSTEM_PROMPT = `Você é um assistente de busca de imóveis da Lopes de Andrade Imóveis. Você interage com corretores da imobiliária — não com clientes finais. Seja objetivo, preciso e técnico. Sem excessos de emojis ou linguagem comercial.

Bairros disponíveis no sistema (use exatamente esses nomes): Bancarios, Mangabeira, Jardim Cidade Universitaria, Geisel, Cristo Redentor, Planalto Da Boa Esperanca, Manaira, Mucumagro, Valentina, Paratibe, Portal Do Sol, Gramame, Torre, Jardim Sao Paulo, Jose Americo, Aeroclube, Altiplano, Jardim Oceania, Tambau, Agua Fria, Centro, Jaguaribe, Colibris, Cuia, Industrias.
Tipos disponíveis: Apartamento, Casa, Terreno, Cobertura, Studio, Sala Comercial.
Características buscáveis: piscina, academia, churrasqueira, playground, portaria 24h, salão de festas, pet-friendly, varanda gourmet, mobiliado.

Regras de busca:
- SEMPRE infira e passe o campo modalidade: "comprar/à venda/venda" → "venda"; "alugar/aluguel/locação" → "aluguel". Se ambíguo, pergunte.
- Use buscar_imoveis sempre que houver critérios suficientes. Só pergunte antes se a mensagem for completamente vaga (sem tipo, bairro, preço ou modalidade).
- NUNCA amplie filtros automaticamente. Se não houver resultados, informe claramente o que não foi encontrado e pergunte ao corretor qual critério ele quer relaxar.
- NUNCA sugira bairros, preços ou alternativas sem antes verificar no sistema com buscar_imoveis.
- valor_condominio: campo numérico nullable (R$/mês). Muitos imóveis não têm esse dado — filtrar por valor_condominio_min/max só retorna imóveis que têm o campo preenchido.
- Custo total (aluguel + condomínio): quando o corretor perguntar pelo total, busque sem filtro de preço (ou com preco_max = valor_total) e calcule o total na resposta usando os dados do sample (preco + valor_condominio de cada imóvel). Informe quais imóveis têm condomínio informado e qual seria o custo total de cada um.

Regras de resposta:
- Quando a busca retornar resultados, responda com UMA FRASE CURTA apenas (ex: "Encontrei 3 apartamentos nos Bancários."). Os cards são enviados automaticamente — não liste imóveis em texto.
- IMPORTANTE: Perguntas de follow-up sobre resultados já exibidos (ex: "todos têm suíte?", "qual o maior?", "têm garagem?", "é mobiliado?", "qual estado do imóvel?") devem ser respondidas em texto usando os dados da amostra já disponível no contexto (campos: detalhes, caracteristicas, pois, suites, garagem, area_m2, mobiliado, andar, etc.). NÃO chame buscar_imoveis novamente para essas perguntas — os cards já foram enviados e não devem ser reenviados.
- Quando não houver resultados, informe diretamente: "Nenhum resultado para [critérios]. Qual filtro deseja ajustar?"
- Quando o corretor confirmar que quer ver os imóveis (ex: "sim", "quero ver", "mostra", "pode mandar"), chame buscar_imoveis com os mesmos filtros da busca anterior.
- Responda em português brasileiro, tom direto e profissional.`;

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
  voiceMode = false,
): Promise<{ texto: string; imoveis: Record<string, unknown>[]; total: number; filters: ToolFilters | null; autoSendCards: boolean }> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  // Carregar histórico
  const { data: conv } = await supabase
    .from("conversations")
    .select("messages, filters, prompt_version")
    .eq("chat_id", chatId)
    .maybeSingle();

  const promptIsStale = conv?.prompt_version !== PROMPT_VERSION;
  const history: unknown[] = promptIsStale ? [] : trimHistory((conv?.messages as unknown[]) ?? []);
  const lastFilters: ToolFilters | null = promptIsStale ? null : (conv?.filters ?? null);

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
  let autoSendCards = !voiceMode; // em modo voz, cards só são enviados se o corretor confirmar

  if (response.stop_reason === "tool_use") {
    // Claude quer buscar imóveis — pode emitir múltiplos tool_use blocks (ex: "venda ou aluguel")
    // A API exige tool_result para TODOS os tool_use blocks ou retorna erro.
    // Executamos apenas o primeiro e passamos resultado vazio para os demais.
    const allToolUseBlocks = (response.content as Array<{ type: string; id?: string; input?: unknown }>)
      .filter((b) => b.type === "tool_use") as Array<{ id: string; type: string; input: unknown }>;

    const toolUseBlock = allToolUseBlocks[0];
    const toolInput = toolUseBlock ? (toolUseBlock.input as ToolFilters) : null;
    // Múltiplos tool_use = Claude está explorando opções, não confirmando resultado
    if (allToolUseBlocks.length > 1) autoSendCards = false;

    if (toolInput && toolUseBlock) {
      activeFilters = toolInput;
      const supabaseFilters = buildSupabaseFilters(toolInput);
      const result = await buscarImoveis(supabaseFilters, supabaseUrl, supabaseKey);
      imoveis = result.data;
      total = result.count;

      // Montar tool_results para TODOS os blocks (primeiro com dados reais, demais vazios)
      const voiceInstruction = voiceMode
        ? "\n\n[MODO ÁUDIO] Gere uma resposta de 3-5 frases faladas naturalmente: (1) total encontrado com bairros e faixa de preço/área, (2) destaque 1-2 características relevantes da amostra (mobiliado, estado, diferenciais), (3) pergunte se o corretor quer visualizar os cards ou sugira um filtro adicional com base nos dados enriquecidos. Não liste imóveis individualmente."
        : "";
      const toolResults = allToolUseBlocks.map((block, idx) => ({
        type: "tool_result" as const,
        tool_use_id: block.id,
        content: idx === 0
          ? JSON.stringify({ total, sample: imoveis.slice(0, 5).map((i) => ({
              titulo:           i.titulo,
              bairro:           i.bairro,
              preco:            i.preco,
              valor_condominio: i.valor_condominio,
              area_m2:          i.area_m2,
              quartos:          i.quartos,
              suites:           i.suites,
              banheiros:        i.banheiros,
              garagem:          i.garagem,
              andar:            i.andar,
              eh_terreo:        i.eh_terreo,
              mobiliado:        i.mobiliado,
              caracteristicas:  i.caracteristicas,
              pois:             i.pois,
              detalhes:         i.detalhes_imovel,
            })) }) + voiceInstruction
          : JSON.stringify({ total: 0, sample: [] }),
      }));

      // Segunda chamada com resultado do tool
      const followUp = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: voiceMode ? 1024 : 512,
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
    { chat_id: chatId, messages: updatedMessages, filters: activeFilters, prompt_version: PROMPT_VERSION, updated_at: new Date().toISOString() },
    { onConflict: "chat_id" },
  );

  return { texto: finalText, imoveis, total, filters: activeFilters, autoSendCards };
}
