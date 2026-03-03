import { useFiltersStore } from "../store/filters";

const SORT_OPTIONS = [
  { value: "recente", label: "Mais recente" },
  { value: "preco_asc", label: "Menor preço" },
  { value: "preco_desc", label: "Maior preço" },
  { value: "area_asc", label: "Menor área" },
  { value: "area_desc", label: "Maior área" },
];

export default function ResultsHeader({ count, loading, ultimaAtualizacao }) {
  const sortBy = useFiltersStore((s) => s.sortBy);
  const setFiltro = useFiltersStore((s) => s.setFiltro);

  const dataFormatada = ultimaAtualizacao
    ? new Date(ultimaAtualizacao).toLocaleDateString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        {loading ? (
          <span className="flex items-center gap-1.5">
            <svg className="animate-spin h-4 w-4 text-brand-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Buscando...
          </span>
        ) : (
          <span>
            <strong className="text-gray-900 font-semibold">{count}</strong>{" "}
            {count === 1 ? "imóvel encontrado" : "imóveis encontrados"}
          </span>
        )}
        {dataFormatada && (
          <span className="hidden sm:inline text-gray-400">
            · Base atualizada em {dataFormatada}
          </span>
        )}
      </div>

      <select
        value={sortBy}
        onChange={(e) => setFiltro("sortBy", e.target.value)}
        className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white
                   focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
