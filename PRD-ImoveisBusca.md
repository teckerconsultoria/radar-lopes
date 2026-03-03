# PRD — Sistema de Busca de Imóveis para Atendimento
**Lopes de Andrade Imóveis**
Versão: 1.0 | Data: Março/2026 | Autor: Corretor Associado

---

## 1. Visão Geral

### 1.1 Problema

O site institucional da imobiliária (lopesdeandrade.com.br) não foi projetado para uso interno durante o atendimento. A busca é lenta, limitada a poucos filtros (basicamente bairro e número de quartos) e não permite combinações complexas de critérios que surgem naturalmente no atendimento ao cliente.

### 1.2 Solução

Uma Progressive Web App (PWA) de uso interno, alimentada por um scraper que extrai e estrutura os dados do site da imobiliária em um banco de dados relacional na nuvem, expondo uma interface de busca rápida, multifiltro e com texto livre — acessível tanto no celular durante visitas quanto no computador no escritório.

### 1.3 Objetivo Principal

> Permitir que o corretor encontre imóveis relevantes em **menos de 10 segundos** durante um atendimento, combinando qualquer conjunto de filtros simultaneamente.

---

## 2. Usuários e Contexto de Uso

| Atributo | Descrição |
|---|---|
| **Usuário primário** | Corretor associado (uso individual) |
| **Dispositivos** | Celular (Android/iOS) + computador desktop/laptop |
| **Contexto** | Durante atendimento presencial, ligações ou WhatsApp com clientes |
| **Conexão** | Assume conexão à internet disponível |
| **Nível técnico** | Não técnico — interface deve ser autoexplicativa |

---

## 3. Requisitos Funcionais

### 3.1 Scraper

| ID | Requisito |
|---|---|
| S-01 | Extrair todos os anúncios ativos do site lopesdeandrade.com.br usando Playwright (renderização JS) |
| S-02 | Extrair da listagem: URL slug, título do anúncio, tipo de imóvel, bairro, data de última modificação |
| S-03 | Extrair da página individual de cada anúncio: preço, área (m²), número de quartos, suítes, banheiros, vagas de garagem, andar, se é térreo, descrição completa |
| S-04 | Identificar automaticamente POIs mencionados na descrição (ex: "próximo ao Shopping Manaíra", "a 200m da praia", "perto da UFPB") |
| S-05 | Identificar automaticamente características implícitas no texto (ex: piscina, varanda, nascente, poente, área de lazer, condomínio fechado, reformado, novo) |
| S-06 | Executar em modo **manual** — o corretor roda o script quando quiser atualizar a base |
| S-07 | Realizar **upsert** no banco (atualiza se já existe, insere se é novo) usando a URL como chave primária |
| S-08 | Marcar como `inativo` anúncios que estavam na base mas não aparecem mais no site |
| S-09 | Exibir ao final do scraping: total processado, novos, atualizados, inativos, erros |
| S-10 | Importar dados do CSV de teste existente como ponto de partida inicial |

### 3.2 Banco de Dados

| ID | Requisito |
|---|---|
| B-01 | Utilizar **Supabase** (PostgreSQL) como banco de dados principal |
| B-02 | Tabela `imoveis` com schema completo conforme seção 5 |
| B-03 | Índice de **Full-Text Search** em português sobre: título, descrição, características, POIs |
| B-04 | Índices convencionais em: tipo, bairro, quartos, suítes, preço, área, garagem, andar, status |
| B-05 | Tabela de auditoria `scraping_logs` registrando cada execução do scraper |
| B-06 | Política de Row Level Security (RLS) desabilitada para uso interno via service key |

### 3.3 Aplicação Web (Frontend)

| ID | Requisito |
|---|---|
| F-01 | PWA instalável no celular (manifest + service worker) |
| F-02 | Layout responsivo: coluna única no mobile, sidebar de filtros no desktop |
| F-03 | **Busca textual livre**: campo principal onde o corretor digita termos livres (ex: "piscina nascente Manaíra 3 quartos") |
| F-04 | **Filtros estruturados** simultâneos: tipo, bairro, faixa de quartos, suítes, garagem, faixa de preço, faixa de área, andar, térreo, características, data de atualização |
| F-05 | Resultados exibidos como **cards** com: título, tipo, bairro, quartos/suítes, preço (se disponível), área, data de atualização e link direto para o anúncio original |
| F-06 | Botão de **link direto** para o anúncio no site da imobiliária (para mostrar ao cliente) |
| F-07 | Ordenação dos resultados por: relevância, mais recente, preço (asc/desc), área |
| F-08 | Contador de resultados em tempo real |
| F-09 | Estado vazio com mensagem útil quando não há resultados |
| F-10 | Sem autenticação — acesso direto pela URL (uso interno) |
| F-11 | Indicador visual de quando a base foi atualizada pela última vez |

---

## 4. Requisitos Não Funcionais

| ID | Requisito |
|---|---|
| NF-01 | Tempo de resposta da busca: < 500ms para qualquer combinação de filtros |
| NF-02 | O scraper deve processar o catálogo completo em < 30 minutos |
| NF-03 | O scraper deve respeitar o servidor: delay de 1–3s entre requisições, sem paralelismo agressivo |
| NF-04 | A aplicação deve funcionar em qualquer browser moderno (Chrome, Safari mobile, Firefox) |
| NF-05 | Custo mensal ≤ R$ 0 no plano inicial (Supabase Free + Vercel Hobby) |
| NF-06 | O scraper deve ser tolerante a falhas: erros em anúncios individuais não interrompem o processo |

---

## 5. Schema do Banco de Dados

### Tabela: `imoveis`

```sql
CREATE TABLE imoveis (
  id                  BIGSERIAL PRIMARY KEY,
  url                 TEXT UNIQUE NOT NULL,          -- URL completa do anúncio
  slug                TEXT,                           -- Slug da URL (chave de upsert)
  titulo              TEXT NOT NULL,                  -- Título do anúncio
  tipo                TEXT,                           -- Apartamento | Casa | Sala Comercial | Terreno | ...
  bairro              TEXT,
  cidade              TEXT DEFAULT 'João Pessoa',
  uf                  TEXT DEFAULT 'PB',

  -- Características numéricas
  preco               NUMERIC,                        -- Em reais
  area_m2             NUMERIC,
  quartos             INTEGER,
  suites              INTEGER,
  banheiros           INTEGER,
  garagem             INTEGER,                        -- Número de vagas
  andar               INTEGER,
  total_andares       INTEGER,

  -- Flags booleanas
  eh_terreo           BOOLEAN DEFAULT FALSE,
  eh_cobertura        BOOLEAN DEFAULT FALSE,
  aceita_financiamento BOOLEAN,
  novo                BOOLEAN DEFAULT FALSE,
  reformado           BOOLEAN DEFAULT FALSE,

  -- Arrays e texto longo
  caracteristicas     TEXT[],                         -- ['piscina','varanda','nascente',...]
  pois                TEXT[],                         -- ['Shopping Manaíra','UFPB','Praia de Tambaú',...]
  descricao           TEXT,                           -- Descrição completa do anúncio
  fotos               TEXT[],                         -- URLs das fotos

  -- Metadados
  status              TEXT DEFAULT 'ativo',           -- ativo | inativo
  fonte               INTEGER DEFAULT 1,
  ultima_modificacao  DATE,
  scraped_at          TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  -- Full-Text Search
  fts                 TSVECTOR GENERATED ALWAYS AS (
                        to_tsvector('portuguese',
                          COALESCE(titulo,'') || ' ' ||
                          COALESCE(bairro,'') || ' ' ||
                          COALESCE(tipo,'') || ' ' ||
                          COALESCE(descricao,'') || ' ' ||
                          COALESCE(array_to_string(caracteristicas,' '),'') || ' ' ||
                          COALESCE(array_to_string(pois,' '),'')
                        )
                      ) STORED
);

-- Índices
CREATE INDEX idx_imoveis_fts      ON imoveis USING GIN(fts);
CREATE INDEX idx_imoveis_tipo     ON imoveis(tipo);
CREATE INDEX idx_imoveis_bairro   ON imoveis(bairro);
CREATE INDEX idx_imoveis_quartos  ON imoveis(quartos);
CREATE INDEX idx_imoveis_preco    ON imoveis(preco);
CREATE INDEX idx_imoveis_area     ON imoveis(area_m2);
CREATE INDEX idx_imoveis_status   ON imoveis(status);
CREATE INDEX idx_imoveis_andar    ON imoveis(andar);
CREATE INDEX idx_imoveis_garagem  ON imoveis(garagem);
```

### Tabela: `scraping_logs`

```sql
CREATE TABLE scraping_logs (
  id            BIGSERIAL PRIMARY KEY,
  iniciado_em   TIMESTAMPTZ DEFAULT NOW(),
  finalizado_em TIMESTAMPTZ,
  total         INTEGER,
  inseridos     INTEGER,
  atualizados   INTEGER,
  inativos      INTEGER,
  erros         INTEGER,
  log_detalhado JSONB
);
```

---

## 6. Filtros da Interface

### Filtros Estruturados (sidebar/painel)

| Filtro | Tipo de Input | Observação |
|---|---|---|
| Busca livre | Campo de texto | FTS em português, busca em tudo |
| Tipo de imóvel | Multi-select | Apartamento, Casa, Sala Comercial, Terreno |
| Bairro | Multi-select com busca | Lista dos bairros disponíveis |
| Quartos | Range slider (0–5+) | "2 a 3 quartos" |
| Suítes | Select (0, 1, 2, 3+) | |
| Vagas de garagem | Select (0, 1, 2, 3+) | |
| Preço | Range com valores manuais | Ex: R$ 200k – R$ 500k |
| Área (m²) | Range com valores manuais | |
| Andar | Campo numérico ou "térreo" | |
| Características | Multi-select com chips | Piscina, Varanda, Nascente, Lazer, etc. |
| POIs próximos | Campo de texto livre | Ex: "praia", "shopping" |
| Atualizado nos últimos | Select | 7 dias, 15 dias, 30 dias, 60 dias |

### Ordenação

- Mais relevante (padrão quando há busca textual)
- Mais recente
- Menor preço
- Maior preço
- Menor área
- Maior área

---

## 7. Stack Técnica Definida

### Backend / Dados
- **Banco:** Supabase (PostgreSQL 15) — plano Free
- **Full-Text Search:** `tsvector` nativo do PostgreSQL em português
- **API:** Supabase JS SDK (chamadas diretas do frontend com `anon key`)

### Scraper
- **Linguagem:** Python 3.11+
- **Browser automation:** Playwright (renderização JS completa)
- **HTTP requests:** HTTPX (fallback para páginas estáticas)
- **Parser:** BeautifulSoup4
- **Supabase client:** `supabase-py`
- **Execução:** Script local, manual

### Frontend
- **Framework:** React 18 + Vite
- **Estilo:** Tailwind CSS
- **PWA:** Vite PWA Plugin (workbox)
- **Deploy:** Vercel (Hobby — gratuito)
- **Gerenciamento de estado:** Zustand ou Context API
- **HTTP:** Supabase JS SDK

---

## 8. Arquitetura de Componentes (Frontend)

```
App
├── SearchBar          ← campo de busca textual principal
├── FilterPanel        ← sidebar com todos os filtros estruturados
│   ├── TipoFilter
│   ├── BairroFilter
│   ├── QuartosFilter
│   ├── PrecoFilter
│   ├── AreaFilter
│   ├── CaracteristicasFilter
│   └── DataFilter
├── ResultsHeader      ← contagem + ordenação + data da última atualização
├── ResultsList
│   └── ImovelCard[]   ← card com dados resumidos + link para anúncio original
└── EmptyState
```

---

## 9. Fluxo de Atualização da Base

```
1. Corretor roda: python scraper.py
2. Scraper autentica no Supabase via service key
3. Coleta lista de slugs ativos no site (paginação)
4. Para cada slug:
   a. Carrega página com Playwright
   b. Extrai todos os campos disponíveis
   c. Faz upsert no Supabase (ON CONFLICT DO UPDATE)
5. Slugs que estavam na base mas não foram encontrados → status = 'inativo'
6. Registra log na tabela scraping_logs
7. Exibe resumo no terminal
```

---

## 10. Plano de Entrega (Fases)

### Fase 1 — Base de dados e importação (MVP do backend)
- [ ] Criar projeto no Supabase
- [ ] Executar migration com schema completo
- [ ] Script de importação do CSV existente (93 imóveis)
- [ ] Validar FTS com queries de teste

### Fase 2 — Scraper completo
- [ ] Scraper com Playwright para listagem + páginas individuais
- [ ] Extração de preço, área, características, POIs
- [ ] Upsert + marcação de inativos
- [ ] Logging + relatório de execução

### Fase 3 — Frontend PWA
- [ ] Setup React + Vite + Tailwind
- [ ] Componente de busca textual
- [ ] Filtros estruturados
- [ ] Cards de resultado com link para anúncio
- [ ] Responsividade mobile-first
- [ ] Manifesto PWA

### Fase 4 — Deploy e refinamento
- [ ] Deploy no Vercel
- [ ] Testes em dispositivos reais (mobile + desktop)
- [ ] Ajustes de UX baseados no uso real
- [ ] Documentação de como rodar o scraper

---

## 11. Fora do Escopo (v1)

- Autenticação e controle de acesso
- Multi-usuário / equipe de corretores
- Agendamento automático do scraper
- Notificações de novos imóveis
- Comparação lado a lado de imóveis
- Integração com WhatsApp ou CRM
- Outros sites de imóveis além da lopesdeandrade.com.br

---

## 12. Riscos e Mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Site bloqueia o scraper (anti-bot) | Média | Delay entre requisições, rotação de user-agent, Playwright com perfil real |
| Estrutura do HTML do site muda | Média | Selectors com fallback, alertas de erro no scraper |
| Dados sem preço (não exibido no site) | Alta | Campo nullable; card exibe "Consulte" quando ausente |
| Supabase Free atingir limite | Baixa (93 imóveis) | Monitorar uso; migrar para Pro (~$25/mês) se necessário |
| PWA não instalar no iOS Safari | Baixa | Testar; iOS 16.4+ suporta PWA com manifest completo |

---

*Documento gerado para alinhamento de desenvolvimento. Sujeito a revisão conforme descobertas durante a implementação.*
