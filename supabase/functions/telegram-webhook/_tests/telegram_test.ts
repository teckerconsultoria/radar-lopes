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
