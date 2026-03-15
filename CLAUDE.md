# CLAUDE.md — Radar Lopes

PWA de busca de imóveis para uso interno da Lopes de Andrade Imóveis.
Dados extraídos de lopesdeandrade.com.br e armazenados no Supabase.

## Comandos

### Scraper (Python)
```bash
cd scraper
pip install -r requirements.txt
playwright install chromium
python scraper.py           # scraping completo (~5-10min)
python scraper.py --test 5  # testa com 5 imóveis
python import_csv.py        # importa CSV inicial para Supabase
```

### Web (React + Vite)
```bash
cd web
npm install
npm run dev    # http://localhost:5173
npm run build
npm run preview
```

## Arquitetura do Scraper — 3 Fases
1. **Fase 1 — Playwright** (~1-2min): captura nonce + chama AJAX para listar todos os cards
2. **Fase 2 — httpx async** (~1-3min): visita páginas individuais em paralelo (sem LLM)
3. **Fase 3 — Batch API** (~2-5min): extração semântica com Claude Batch API + upsert no Supabase

## Variáveis de Ambiente

### `scraper/.env`
```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=   # service_role key (não anon)
ANTHROPIC_API_KEY=
```

### `web/.env`
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Estrutura
```
radar-lopes/
├── scraper/
│   ├── scraper.py        ← scraper principal (3 fases)
│   ├── import_csv.py     ← importa CSV histórico
│   └── requirements.txt
├── web/src/
│   ├── components/       ← SearchBar, FilterPanel, ImovelCard, ResultsList
│   ├── lib/              ← supabase.js, queries.js
│   ├── store/            ← filters.js (Zustand)
│   └── hooks/            ← useImoveis.js
└── supabase/migrations/001_initial_schema.sql
```

## Banco de Dados
- Tabela principal: `imoveis` (url como chave primária via UNIQUE)
- Full-Text Search em português sobre título, descrição, características, POIs
- `scraping_logs` para auditoria de execuções
- RLS desabilitado (uso interno via service key)

## Gotchas
- O site usa AJAX com nonce dinâmico — Playwright é obrigatório na Fase 1
- O scraper usa `SUPABASE_SERVICE_KEY` (service_role), não a anon key
- `import_csv.py` deve ser rodado apenas uma vez para seed inicial
- Deploy: Vercel com Root Directory = `web`
