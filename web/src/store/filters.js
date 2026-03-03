import { create } from "zustand";

export const useFiltersStore = create((set, get) => ({
  // ── Filtros ───────────────────────────────────────────────────────────────
  texto: "",
  tipos: [],
  bairros: [],
  quartosMin: null,
  quartosMax: null,
  suitesMin: null,
  garagemMin: null,
  precoMin: null,
  precoMax: null,
  areaMin: null,
  areaMax: null,
  andar: null,
  ehTerreo: false,
  caracteristicas: [],
  diasAtualizacao: null,

  // ── Ordenação ─────────────────────────────────────────────────────────────
  sortBy: "recente",

  // ── Actions ───────────────────────────────────────────────────────────────
  setFiltro: (key, value) => set({ [key]: value }),

  toggleTipo: (tipo) =>
    set((s) => ({
      tipos: s.tipos.includes(tipo)
        ? s.tipos.filter((t) => t !== tipo)
        : [...s.tipos, tipo],
    })),

  toggleBairro: (bairro) =>
    set((s) => ({
      bairros: s.bairros.includes(bairro)
        ? s.bairros.filter((b) => b !== bairro)
        : [...s.bairros, bairro],
    })),

  toggleCaracteristica: (carac) =>
    set((s) => ({
      caracteristicas: s.caracteristicas.includes(carac)
        ? s.caracteristicas.filter((c) => c !== carac)
        : [...s.caracteristicas, carac],
    })),

  limparFiltros: () =>
    set({
      texto: "",
      tipos: [],
      bairros: [],
      quartosMin: null,
      quartosMax: null,
      suitesMin: null,
      garagemMin: null,
      precoMin: null,
      precoMax: null,
      areaMin: null,
      areaMax: null,
      andar: null,
      ehTerreo: false,
      caracteristicas: [],
      diasAtualizacao: null,
    }),

  temFiltrosAtivos: () => {
    const s = get();
    return (
      s.texto ||
      s.tipos.length ||
      s.bairros.length ||
      s.quartosMin != null ||
      s.quartosMax != null ||
      s.suitesMin != null ||
      s.garagemMin != null ||
      s.precoMin != null ||
      s.precoMax != null ||
      s.areaMin != null ||
      s.areaMax != null ||
      s.andar != null ||
      s.ehTerreo ||
      s.caracteristicas.length ||
      s.diasAtualizacao != null
    );
  },
}));
