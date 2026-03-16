// supabase/functions/telegram-webhook/_tests/telegram_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseUpdate, formatCaption } from "../modules/telegram.ts";

Deno.test("parseUpdate - mensagem de texto", () => {
  const update = {
    update_id: 1,
    message: {
      message_id: 10,
      chat: { id: 123456789 },
      text: "quero apartamento em Manaíra",
    },
  };
  const result = parseUpdate(update);
  assertEquals(result.type, "text");
  assertEquals(result.chatId, 123456789);
  assertEquals(result.text, "quero apartamento em Manaíra");
});

Deno.test("parseUpdate - mensagem de voz", () => {
  const update = {
    update_id: 2,
    message: {
      message_id: 11,
      chat: { id: 123456789 },
      voice: { file_id: "abc123", duration: 5 },
    },
  };
  const result = parseUpdate(update);
  assertEquals(result.type, "voice");
  assertEquals(result.chatId, 123456789);
  assertEquals(result.fileId, "abc123");
});

Deno.test("parseUpdate - callback_query paginação", () => {
  const update = {
    update_id: 3,
    callback_query: {
      id: "cb1",
      from: { id: 123456789 },
      data: "page:2",
    },
  };
  const result = parseUpdate(update);
  assertEquals(result.type, "page");
  assertEquals(result.chatId, 123456789);
  assertEquals(result.page, 2);
});

Deno.test("formatCaption - imóvel completo", () => {
  const imovel = {
    titulo: "Apto 3 Quartos Manaíra",
    bairro: "Manaíra",
    tipo: "Apartamento",
    quartos: 3,
    suites: 1,
    garagem: 2,
    area_m2: 95,
    preco: 650000,
    url: "https://lopesdeandrade.com.br/imovel/123",
  };
  const caption = formatCaption(imovel);
  assertEquals(caption.includes("🏠 Apto 3 Quartos Manaíra"), true);
  assertEquals(caption.includes("📍 Manaíra · Apartamento"), true);
  assertEquals(caption.includes("🛏 3q"), true);
  assertEquals(caption.includes("💰 R$ 650.000"), true);
});

Deno.test("formatCaption - preço nulo não quebra", () => {
  const imovel = {
    titulo: "Terreno Bessa",
    bairro: "Bessa",
    tipo: "Terreno",
    quartos: null,
    suites: null,
    garagem: null,
    area_m2: 300,
    preco: null,
    url: "https://lopesdeandrade.com.br/imovel/456",
  };
  const caption = formatCaption(imovel);
  assertEquals(caption.includes("💰 Consulte"), true);
});

Deno.test("formatCaption - exibe endereco quando presente", () => {
  const imovel = {
    titulo: "Apto Manaíra",
    bairro: "Manaíra",
    tipo: "Apartamento",
    quartos: 3,
    suites: 1,
    garagem: 1,
    area_m2: 90,
    preco: 500000,
    fotos: null,
    url: "https://lopesdeandrade.com.br/imovel/123",
    endereco: "Rua das Flores, 123",
  };
  const caption = formatCaption(imovel);
  assertEquals(caption.includes("🗺 Rua das Flores, 123"), true);
});

Deno.test("formatCaption - omite linha endereco quando null", () => {
  const imovel = {
    titulo: "Apto Bessa",
    bairro: "Bessa",
    tipo: "Apartamento",
    quartos: 2,
    suites: null,
    garagem: null,
    area_m2: 70,
    preco: 300000,
    fotos: null,
    url: "https://lopesdeandrade.com.br/imovel/456",
    endereco: null,
  };
  const caption = formatCaption(imovel);
  assertEquals(caption.includes("🗺"), false);
});

Deno.test("formatCaption - exibe condominio inline com preco", () => {
  const imovel = {
    titulo: "Apto Cabo Branco",
    bairro: "Cabo Branco",
    tipo: "Apartamento",
    quartos: 3,
    suites: 1,
    garagem: 2,
    area_m2: 100,
    preco: 750000,
    fotos: null,
    url: "https://lopesdeandrade.com.br/imovel/789",
    valor_condominio: 600,
  };
  const caption = formatCaption(imovel);
  assertEquals(caption.includes("🏢 Cond."), true);
  assertEquals(caption.includes("R$ 600"), true);
});

Deno.test("formatCaption - exibe acabamentos e amenidades", () => {
  const imovel = {
    titulo: "Apto Tambaú",
    bairro: "Tambaú",
    tipo: "Apartamento",
    quartos: 3,
    suites: 2,
    garagem: 2,
    area_m2: 120,
    preco: 900000,
    fotos: null,
    url: "https://lopesdeandrade.com.br/imovel/abc",
    detalhes_imovel: {
      acabamentos: ["piso porcelanato", "cozinha planejada", "ar-condicionado"],
      condominio: ["piscina", "academia", "portaria 24h"],
      localizacao_detalhes: ["a 200m da praia"],
      observacoes_extras: ["IPTU R$ 120/mês"],
    },
  };
  const caption = formatCaption(imovel);
  assertEquals(caption.includes("🪟"), true);
  assertEquals(caption.includes("piso porcelanato"), true);
  assertEquals(caption.includes("🏊"), true);
  assertEquals(caption.includes("piscina"), true);
  assertEquals(caption.includes("📌"), true);
  assertEquals(caption.includes("📝"), true);
  assertEquals(caption.includes("IPTU R$ 120/mês"), true);
});

Deno.test("formatCaption - trunca endereco longo", () => {
  const imovel = {
    titulo: "Apto",
    bairro: "Bairro",
    tipo: "Apartamento",
    quartos: 2,
    suites: null,
    garagem: null,
    area_m2: 60,
    preco: 200000,
    fotos: null,
    url: "https://lopesdeandrade.com.br/imovel/trunc",
    endereco: "Avenida Presidente Epitácio Pessoa, número 1500, Bloco B, Apartamento 402",
  };
  const caption = formatCaption(imovel);
  assertEquals(caption.includes("🗺"), true);
  const lines = caption.split("\n");
  const endLine = lines.find((l) => l.startsWith("🗺"));
  assertEquals(endLine !== undefined, true);
  assertEquals(endLine!.length <= 65, true);
});

Deno.test("formatCaption - caption nao excede 1024 chars", () => {
  const imovel = {
    titulo: "Título muito longo ".repeat(10),
    bairro: "Bairro",
    tipo: "Apartamento",
    quartos: 4,
    suites: 3,
    garagem: 3,
    area_m2: 200,
    preco: 1500000,
    fotos: null,
    valor_condominio: 1200,
    url: "https://lopesdeandrade.com.br/imovel/long",
    endereco: "Rua muito longa mesmo de verdade, número 9999, Apartamento 101",
    detalhes_imovel: {
      estado_imovel: "reformado",
      diferenciais: ["sol da manhã", "vista mar", "andar alto"],
      acabamentos: ["piso porcelanato", "cozinha planejada", "ar-condicionado"],
      condominio: ["piscina", "academia", "portaria 24h"],
      localizacao_detalhes: ["a 200m da praia", "próximo ao shopping"],
      observacoes_extras: ["IPTU R$ 200/mês", "semi-mobiliado", "pronto para morar"],
    },
  };
  const caption = formatCaption(imovel);
  assertEquals(caption.length <= 1024, true);
});
