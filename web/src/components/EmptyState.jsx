import { useFiltersStore } from "../store/filters";

export default function EmptyState({ loading }) {
  const limparFiltros = useFiltersStore((s) => s.limparFiltros);
  const temFiltrosAtivos = useFiltersStore((s) =>
    !!(s.texto || s.tipos.length || s.bairros.length || s.quartosMin != null ||
       s.quartosMax != null || s.suitesMin != null || s.garagemMin != null ||
       s.precoMin != null || s.precoMax != null || s.areaMin != null ||
       s.areaMax != null || s.andar != null || s.ehTerreo ||
       s.caracteristicas.length || s.diasAtualizacao != null)
  );

  if (loading) return null;

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-4">
      <div className="text-5xl mb-4">🏘️</div>
      <h3 className="text-lg font-semibold text-gray-700 mb-2">
        Nenhum imóvel encontrado
      </h3>
      <p className="text-sm text-gray-500 max-w-xs mb-6">
        Tente termos mais simples, remova alguns filtros ou amplie as faixas de preço e área.
      </p>
      {temFiltrosAtivos && (
        <button onClick={limparFiltros} className="btn-primary">
          Limpar filtros
        </button>
      )}
    </div>
  );
}
