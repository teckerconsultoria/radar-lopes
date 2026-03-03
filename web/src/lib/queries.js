import { supabase } from "./supabase";

/**
 * Busca imóveis com filtros combinados.
 * @param {object} filters - objeto com todos os filtros ativos
 * @param {string} sortBy  - campo de ordenação
 * @returns {Promise<{data: Array, count: number, error: any}>}
 */
export async function buscarImoveis(filters = {}, sortBy = "scraped_at") {
  let query = supabase
    .from("imoveis")
    .select("*", { count: "exact" })
    .eq("status", "ativo");

  // ── Full-Text Search ──────────────────────────────────────────────────────
  if (filters.texto?.trim()) {
    query = query.textSearch("fts", filters.texto.trim(), {
      config: "portuguese",
      type: "websearch",
    });
  }

  // ── Filtros estruturados ──────────────────────────────────────────────────
  if (filters.tipos?.length) {
    query = query.in("tipo", filters.tipos);
  }

  if (filters.bairros?.length) {
    query = query.in("bairro", filters.bairros);
  }

  if (filters.quartosMin != null) {
    query = query.gte("quartos", filters.quartosMin);
  }
  if (filters.quartosMax != null) {
    query = query.lte("quartos", filters.quartosMax);
  }

  if (filters.suitesMin != null) {
    query = query.gte("suites", filters.suitesMin);
  }

  if (filters.garagemMin != null) {
    query = query.gte("garagem", filters.garagemMin);
  }

  if (filters.precoMin != null) {
    query = query.gte("preco", filters.precoMin);
  }
  if (filters.precoMax != null) {
    query = query.lte("preco", filters.precoMax);
  }

  if (filters.areaMin != null) {
    query = query.gte("area_m2", filters.areaMin);
  }
  if (filters.areaMax != null) {
    query = query.lte("area_m2", filters.areaMax);
  }

  if (filters.andar != null) {
    query = query.eq("andar", filters.andar);
  }

  if (filters.ehTerreo) {
    query = query.eq("eh_terreo", true);
  }

  if (filters.caracteristicas?.length) {
    query = query.overlaps("caracteristicas", filters.caracteristicas);
  }

  if (filters.diasAtualizacao) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filters.diasAtualizacao);
    query = query.gte("ultima_modificacao", cutoff.toISOString().slice(0, 10));
  }

  // ── Ordenação ─────────────────────────────────────────────────────────────
  switch (sortBy) {
    case "preco_asc":
      query = query.order("preco", { ascending: true, nullsFirst: false });
      break;
    case "preco_desc":
      query = query.order("preco", { ascending: false, nullsFirst: false });
      break;
    case "area_asc":
      query = query.order("area_m2", { ascending: true, nullsFirst: false });
      break;
    case "area_desc":
      query = query.order("area_m2", { ascending: false, nullsFirst: false });
      break;
    case "recente":
    default:
      query = query.order("ultima_modificacao", { ascending: false, nullsFirst: false });
      break;
  }

  query = query.limit(200);

  const { data, count, error } = await query;
  return { data: data ?? [], count: count ?? 0, error };
}

/** Retorna valores distintos para popular filtros. */
export async function buscarOpcoesFilters() {
  const [tipos, bairros, caracteristicas, ultimaAtualizacao] = await Promise.all([
    supabase
      .from("imoveis")
      .select("tipo")
      .eq("status", "ativo")
      .not("tipo", "is", null)
      .order("tipo"),

    supabase
      .from("imoveis")
      .select("bairro")
      .eq("status", "ativo")
      .not("bairro", "is", null)
      .order("bairro"),

    supabase
      .from("imoveis")
      .select("caracteristicas")
      .eq("status", "ativo")
      .not("caracteristicas", "is", null),

    supabase
      .from("scraping_logs")
      .select("finalizado_em")
      .order("finalizado_em", { ascending: false })
      .limit(1),
  ]);

  const tiposUnicos = [...new Set((tipos.data ?? []).map((r) => r.tipo))];
  const bairrosUnicos = [...new Set((bairros.data ?? []).map((r) => r.bairro))];
  const caracUnicos = [
    ...new Set(
      (caracteristicas.data ?? []).flatMap((r) => r.caracteristicas ?? [])
    ),
  ].sort();

  return {
    tipos: tiposUnicos,
    bairros: bairrosUnicos,
    caracteristicas: caracUnicos,
    ultimaAtualizacao: ultimaAtualizacao.data?.[0]?.finalizado_em ?? null,
  };
}
