// supabase/functions/telegram-webhook/_tests/agent_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { trimHistory, extractToolInput } from "../modules/agent.ts";

Deno.test("trimHistory - mantém últimas 20 mensagens", () => {
  const messages = Array.from({ length: 25 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `msg ${i}`,
  }));
  const trimmed = trimHistory(messages);
  assertEquals(trimmed.length, 20);
  assertEquals((trimmed[0] as { content: string }).content, "msg 5");
});

Deno.test("trimHistory - mantém histórico curto intacto", () => {
  const messages = [
    { role: "user", content: "olá" },
    { role: "assistant", content: "oi" },
  ];
  const trimmed = trimHistory(messages);
  assertEquals(trimmed.length, 2);
});

Deno.test("extractToolInput - extrai input do tool use block", () => {
  const content = [
    {
      type: "tool_use",
      id: "tu_1",
      name: "buscar_imoveis",
      input: { tipos: ["Apartamento"], quartos_min: 3 },
    },
  ];
  const result = extractToolInput(content);
  assertEquals(result?.tipos, ["Apartamento"]);
  assertEquals(result?.quartos_min, 3);
});

Deno.test("extractToolInput - retorna null se sem tool use", () => {
  const content = [{ type: "text", text: "Qual bairro você prefere?" }];
  const result = extractToolInput(content);
  assertEquals(result, null);
});
