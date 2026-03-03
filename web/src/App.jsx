import { useState, useEffect } from "react";
import SearchBar from "./components/SearchBar";
import FilterPanel from "./components/FilterPanel";
import ResultsHeader from "./components/ResultsHeader";
import ResultsList from "./components/ResultsList";
import { useImoveis } from "./hooks/useImoveis";
import { buscarOpcoesFilters } from "./lib/queries";
import { useFiltersStore } from "./store/filters";

export default function App() {
  const [filterOpen, setFilterOpen] = useState(false);
  const [opcoes, setOpcoes] = useState(null);
  const { imoveis, count, loading, error } = useImoveis();
  const temFiltrosAtivos = useFiltersStore((s) => s.temFiltrosAtivos);

  useEffect(() => {
    buscarOpcoesFilters().then(setOpcoes);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-brand-900 text-white shadow-lg">
        <div className="max-w-screen-xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3 mb-3">
            <div>
              <h1 className="text-xl font-bold leading-tight">Radar Lopes</h1>
              <p className="text-brand-200 text-xs">Lopes de Andrade Imóveis</p>
            </div>
          </div>
          <SearchBar />
        </div>
      </header>

      <div className="max-w-screen-xl mx-auto px-4 py-4">
        {/* Barra mobile: filtros + contador */}
        <div className="lg:hidden flex items-center justify-between mb-3">
          <button
            onClick={() => setFilterOpen(true)}
            className="flex items-center gap-2 bg-white border border-gray-300 rounded-lg
                       px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
            </svg>
            Filtros
            {temFiltrosAtivos() && (
              <span className="bg-brand-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                ●
              </span>
            )}
          </button>
          <span className="text-sm text-gray-600">
            {loading ? "..." : `${count} imóveis`}
          </span>
        </div>

        <div className="flex gap-6 items-start">
          {/* Filtros */}
          <FilterPanel
            opcoes={opcoes}
            isOpen={filterOpen}
            onClose={() => setFilterOpen(false)}
          />

          {/* Conteúdo principal */}
          <main className="flex-1 min-w-0">
            <ResultsHeader
              count={count}
              loading={loading}
              ultimaAtualizacao={opcoes?.ultimaAtualizacao}
            />

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">
                Erro ao carregar imóveis. Verifique as variáveis de ambiente.
              </div>
            )}

            <ResultsList imoveis={imoveis} loading={loading} />
          </main>
        </div>
      </div>
    </div>
  );
}
