import { useFiltersStore } from "../../store/filters";

const OPCOES = [0, 1, 2, 3, 4, 5];

export default function QuartosFilter() {
  const quartosMin = useFiltersStore((s) => s.quartosMin);
  const quartosMax = useFiltersStore((s) => s.quartosMax);
  const setFiltro = useFiltersStore((s) => s.setFiltro);

  const setMin = (v) => {
    const n = v === "" ? null : Number(v);
    setFiltro("quartosMin", n);
    if (quartosMax != null && n != null && n > quartosMax) {
      setFiltro("quartosMax", null);
    }
  };

  const setMax = (v) => {
    const n = v === "" ? null : Number(v);
    setFiltro("quartosMax", n);
  };

  return (
    <div>
      <label className="filter-label">Quartos</label>
      <div className="flex gap-2 items-center">
        <select value={quartosMin ?? ""} onChange={(e) => setMin(e.target.value)} className="filter-input">
          <option value="">Mín</option>
          {OPCOES.map((n) => (
            <option key={n} value={n}>{n === 5 ? "5+" : n}</option>
          ))}
        </select>
        <span className="text-gray-400 text-sm">até</span>
        <select value={quartosMax ?? ""} onChange={(e) => setMax(e.target.value)} className="filter-input">
          <option value="">Máx</option>
          {OPCOES.filter((n) => quartosMin == null || n >= quartosMin).map((n) => (
            <option key={n} value={n}>{n === 5 ? "5+" : n}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
