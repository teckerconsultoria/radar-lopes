// supabase/functions/telegram-webhook/modules/search.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface ToolFilters {
  tipos?: string[];
  bairros?: string[];
  quartos_min?: number;
  quartos_max?: number;
  suites_min?: number;
  garagem_min?: number;
  preco_min?: number;
  preco_max?: number;
  area_min?: number;
  area_max?: number;
  eh_terreo?: boolean;
  aceita_financiamento?: boolean;
  novo?: boolean;
  reformado?: boolean;
  mobiliado?: boolean;
  caracteristicas?: string[];
  texto?: string;
  modalidade?: "venda" | "aluguel";
  sort_by?: "recente" | "preco_asc" | "preco_desc" | "area_asc" | "area_desc";
}

export interface SupabaseFilters {
  tipos?: string[];
  bairros?: string[];
  quartosMin?: number;
  quartosMax?: number;
  suitesMin?: number;
  garagemMin?: number;
  precoMin?: number;
  precoMax?: number;
  areaMin?: number;
  areaMax?: number;
  ehTerreo?: boolean;
  aceitaFinanciamento?: boolean;
  novo?: boolean;
  reformado?: boolean;
  mobiliado?: boolean;
  caracteristicas?: string[];
  texto?: string;
  modalidade?: "venda" | "aluguel";
  sortBy?: "recente" | "preco_asc" | "preco_desc" | "area_asc" | "area_desc";
}

// ── Mapeamento snake_case → camelCase ─────────────────────────────────────────

/** Remove acentos para normalizar nomes de bairros (banco usa sem acento) */
function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function buildSupabaseFilters(toolInput: ToolFilters): SupabaseFilters {
  return {
    tipos:               toolInput.tipos,
    bairros:             toolInput.bairros?.map(removeAccents),
    quartosMin:          toolInput.quartos_min,
    quartosMax:          toolInput.quartos_max,
    suitesMin:           toolInput.suites_min,
    garagemMin:          toolInput.garagem_min,
    precoMin:            toolInput.preco_min,
    precoMax:            toolInput.preco_max,
    areaMin:             toolInput.area_min,
    areaMax:             toolInput.area_max,
    ehTerreo:            toolInput.eh_terreo,
    aceitaFinanciamento: toolInput.aceita_financiamento,
    novo:                toolInput.novo,
    reformado:           toolInput.reformado,
    mobiliado:           toolInput.mobiliado,
    caracteristicas:     toolInput.caracteristicas,
    texto:               toolInput.texto,
    modalidade:          toolInput.modalidade,
    sortBy:              toolInput.sort_by,
  };
}

// ── Busca ─────────────────────────────────────────────────────────────────────

export async function buscarImoveis(
  filters: SupabaseFilters,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<{ data: Record<string, unknown>[]; count: number }> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  let query = supabase
    .from("imoveis")
    .select("*", { count: "exact" })
    .eq("status", "ativo");

  if (filters.texto?.trim()) {
    query = query.textSearch("fts", filters.texto.trim(), { config: "portuguese", type: "websearch" });
  }
  if (filters.tipos?.length)         query = query.in("tipo", filters.tipos);
  if (filters.bairros?.length)       query = query.in("bairro", filters.bairros);
  if (filters.quartosMin != null)    query = query.gte("quartos", filters.quartosMin);
  if (filters.quartosMax != null)    query = query.lte("quartos", filters.quartosMax);
  if (filters.suitesMin != null)     query = query.gte("suites", filters.suitesMin);
  if (filters.garagemMin != null)    query = query.gte("garagem", filters.garagemMin);
  if (filters.precoMin != null)      query = query.gte("preco", filters.precoMin);
  if (filters.precoMax != null)      query = query.lte("preco", filters.precoMax);
  if (filters.areaMin != null)       query = query.gte("area_m2", filters.areaMin);
  if (filters.areaMax != null)       query = query.lte("area_m2", filters.areaMax);
  if (filters.ehTerreo)              query = query.eq("eh_terreo", true);
  if (filters.aceitaFinanciamento)   query = query.eq("aceita_financiamento", true);
  if (filters.novo)                  query = query.eq("novo", true);
  if (filters.reformado)             query = query.eq("reformado", true);
  if (filters.mobiliado != null)     query = query.eq("mobiliado", filters.mobiliado);
  if (filters.caracteristicas?.length) query = query.overlaps("caracteristicas", filters.caracteristicas);
  if (filters.modalidade)              query = query.eq("modalidade", filters.modalidade);

  switch (filters.sortBy) {
    case "preco_asc":  query = query.order("preco",          { ascending: true,  nullsFirst: false }); break;
    case "preco_desc": query = query.order("preco",          { ascending: false, nullsFirst: false }); break;
    case "area_asc":   query = query.order("area_m2",        { ascending: true,  nullsFirst: false }); break;
    case "area_desc":  query = query.order("area_m2",        { ascending: false, nullsFirst: false }); break;
    default:           query = query.order("ultima_modificacao", { ascending: false, nullsFirst: false });
  }

  query = query.limit(50);
  const { data, count, error } = await query;
  if (error) throw new Error(`Supabase error: ${error.message}`);
  return { data: data ?? [], count: count ?? 0 };
}

// ── Tool definition para Claude ───────────────────────────────────────────────

export const BUSCAR_IMOVEIS_TOOL = {
  name: "buscar_imoveis",
  description: "Busca imóveis no banco de dados com filtros extraídos da conversa. Use sempre que o usuário indicar critérios de busca.",
  input_schema: {
    type: "object",
    properties: {
      tipos:                { type: "array", items: { type: "string" }, description: "Ex: ['Apartamento','Casa']" },
      bairros:              { type: "array", items: { type: "string" }, description: "Bairros de João Pessoa" },
      quartos_min:          { type: "integer" },
      quartos_max:          { type: "integer" },
      suites_min:           { type: "integer" },
      garagem_min:          { type: "integer" },
      preco_min:            { type: "number", description: "Preço mínimo em R$" },
      preco_max:            { type: "number", description: "Preço máximo em R$" },
      area_min:             { type: "number", description: "Área mínima em m²" },
      area_max:             { type: "number", description: "Área máxima em m²" },
      eh_terreo:            { type: "boolean" },
      aceita_financiamento: { type: "boolean" },
      novo:                 { type: "boolean" },
      reformado:            { type: "boolean" },
      mobiliado:            { type: "boolean", description: "true para imóveis mobiliados" },
      caracteristicas:      { type: "array", items: { type: "string" }, description: "Ex: ['piscina','academia']" },
      texto:                { type: "string", description: "Busca em texto livre" },
      modalidade:           { type: "string", enum: ["venda", "aluguel"], description: "OBRIGATÓRIO: 'venda' para compra, 'aluguel' para locação" },
      sort_by:              { type: "string", enum: ["recente","preco_asc","preco_desc","area_asc","area_desc"] },
    },
  },
};
