// supabase/functions/telegram-webhook/_tests/search_test.ts
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSupabaseFilters, BUSCAR_IMOVEIS_TOOL } from "../modules/search.ts";

Deno.test("buildSupabaseFilters - converte snake_case para campos Supabase", () => {
  const toolInput = {
    tipos: ["Apartamento", "Casa"],
    bairros: ["Manaíra"],
    quartos_min: 3,
    preco_max: 800000,
    caracteristicas: ["piscina"],
  };
  const filters = buildSupabaseFilters(toolInput);
  assertEquals(filters.tipos, ["Apartamento", "Casa"]);
  assertEquals(filters.bairros, ["Manaíra"]);
  assertEquals(filters.quartosMin, 3);
  assertEquals(filters.precoMax, 800000);
  assertEquals(filters.caracteristicas, ["piscina"]);
});

Deno.test("buildSupabaseFilters - campos booleanos opcionais", () => {
  const filters = buildSupabaseFilters({ eh_terreo: true, aceita_financiamento: true });
  assertEquals(filters.ehTerreo, true);
  assertEquals(filters.aceitaFinanciamento, true);
});

Deno.test("buildSupabaseFilters - campos ausentes ficam undefined", () => {
  const filters = buildSupabaseFilters({});
  assertEquals(filters.quartosMin, undefined);
  assertEquals(filters.precoMin, undefined);
});

Deno.test("BUSCAR_IMOVEIS_TOOL - tem name e input_schema", () => {
  assertExists(BUSCAR_IMOVEIS_TOOL.name);
  assertExists(BUSCAR_IMOVEIS_TOOL.input_schema);
  assertEquals(BUSCAR_IMOVEIS_TOOL.name, "buscar_imoveis");
});
