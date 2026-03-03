import { useFiltersStore } from "../../store/filters";

export default function TipoFilter({ tipos }) {
  const selected = useFiltersStore((s) => s.tipos);
  const toggle = useFiltersStore((s) => s.toggleTipo);

  if (!tipos?.length) return null;

  return (
    <div>
      <label className="filter-label">Tipo de imóvel</label>
      <div className="flex flex-wrap gap-1.5">
        {tipos.map((t) => (
          <button
            key={t}
            onClick={() => toggle(t)}
            className={`chip ${selected.includes(t) ? "chip-active" : "chip-inactive"}`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
