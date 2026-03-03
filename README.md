# Radar Lopes — Busca de Imóveis

PWA interna para busca rápida de imóveis durante atendimento ao cliente.
**Lopes de Andrade Imóveis** — João Pessoa/PB

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Banco | Supabase (PostgreSQL 15) |
| FTS | `tsvector` em português |
| Scraper | Python 3.12 + Playwright |
| Frontend | React 18 + Vite + Tailwind CSS |
| Deploy | Vercel (Hobby) |

## Estrutura

```
radar-lopes/
├── supabase/migrations/    # Schema SQL
├── scraper/                # Scraper Python
│   ├── scraper.py          # Scraping completo do site
│   └── import_csv.py       # Importação do CSV existente
└── web/                    # PWA React
    └── src/
        ├── components/     # SearchBar, FilterPanel, ImovelCard...
        ├── lib/            # Supabase client + queries
        ├── store/          # Zustand (filtros)
        └── hooks/          # useImoveis
```

## Setup

### 1. Banco de Dados (Supabase)

1. Crie um projeto em [supabase.com](https://supabase.com)
2. Execute o migration:
   ```
   supabase/migrations/001_initial_schema.sql
   ```
3. Anote `URL` e `anon key` (para o frontend) e `service_role key` (para o scraper)

### 2. Scraper (Python)

```bash
cd scraper
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium

cp .env.example .env
# edite .env com suas credenciais Supabase

# Importar CSV existente
python import_csv.py imoveis.csv

# Scraping completo
python scraper.py

# Testar com 5 imóveis
python scraper.py --test 5
```

### 3. Frontend (React)

```bash
cd web
npm install

cp .env.example .env
# edite .env com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY

npm run dev      # desenvolvimento
npm run build    # produção
```

### 4. Deploy (Vercel)

1. Importe o repositório no Vercel
2. Configure `Root Directory` como `web`
3. Adicione as variáveis de ambiente `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
4. Deploy automático a cada push

## Fases de Entrega

- [x] **Fase 1** — Schema do banco + migration SQL
- [x] **Fase 2** — Scraper Playwright + importação CSV
- [x] **Fase 3** — Frontend PWA (busca + filtros + cards)
- [ ] **Fase 4** — Deploy Vercel + testes em dispositivos reais
