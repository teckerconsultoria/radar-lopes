import { useFiltersStore } from "../store/filters";

export default function SearchBar() {
  const texto = useFiltersStore((s) => s.texto);
  const setFiltro = useFiltersStore((s) => s.setFiltro);

  return (
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
        <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <input
        type="search"
        placeholder="Buscar por: piscina, nascente, Manaíra, 3 quartos, cobertura..."
        value={texto}
        onChange={(e) => setFiltro("texto", e.target.value)}
        className="w-full pl-11 pr-4 py-3.5 text-base border-0 rounded-xl shadow-sm
                   bg-white focus:outline-none focus:ring-2 focus:ring-brand-500
                   placeholder:text-gray-400"
      />
      {texto && (
        <button
          onClick={() => setFiltro("texto", "")}
          className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
