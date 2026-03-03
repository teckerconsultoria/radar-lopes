import { useState } from "react";
import { useFiltersStore } from "../../store/filters";

export default function BairroFilter({ bairros }) {
  const [busca, setBusca] = useState("");
  const selected = useFiltersStore((s) => s.bairros);
  const toggle = useFiltersStore((s) => s.toggleBairro);

  if (!bairros?.length) return null;

  const filtrados = busca
    ? bairros.filter((b) => b.toLowerCase().includes(busca.toLowerCase()))
    : bairros;

  return (
    <div>
      <label className="filter-label">Bairro</label>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {selected.map((b) => (
            <button
              key={b}
              onClick={() => toggle(b)}
              className="chip chip-active text-xs"
            >
              {b} ×
            </button>
          ))}
        </div>
      )}
      <input
        type="search"
        placeholder="Buscar bairro..."
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        className="filter-input mb-2"
      />
      <div className="max-h-40 overflow-y-auto space-y-0.5">
        {filtrados.slice(0, 50).map((b) => (
          <button
            key={b}
            onClick={() => toggle(b)}
            className={`w-full text-left px-2 py-1 text-sm rounded transition-colors ${
              selected.includes(b)
                ? "bg-brand-100 text-brand-800 font-medium"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            {b}
          </button>
        ))}
      </div>
    </div>
  );
}
