import { useFiltersStore } from "../../store/filters";
import TipoFilter from "./TipoFilter";
import BairroFilter from "./BairroFilter";
import QuartosFilter from "./QuartosFilter";
import PrecoFilter from "./PrecoFilter";
import AreaFilter from "./AreaFilter";
import CaracteristicasFilter from "./CaracteristicasFilter";

const SUITES_OPT = [
  { value: "", label: "Qualquer" },
  { value: 1, label: "1+" },
  { value: 2, label: "2+" },
  { value: 3, label: "3+" },
];

const GARAGEM_OPT = [
  { value: "", label: "Qualquer" },
  { value: 1, label: "1+" },
  { value: 2, label: "2+" },
  { value: 3, label: "3+" },
];

const DIAS_OPT = [
  { value: "", label: "Qualquer" },
  { value: 7, label: "Últimos 7 dias" },
  { value: 15, label: "Últimos 15 dias" },
  { value: 30, label: "Últimos 30 dias" },
  { value: 60, label: "Últimos 60 dias" },
];

export default function FilterPanel({ opcoes, isOpen, onClose }) {
  const setFiltro = useFiltersStore((s) => s.setFiltro);
  const limparFiltros = useFiltersStore((s) => s.limparFiltros);
  const temFiltrosAtivos = useFiltersStore((s) =>
    !!(s.texto || s.tipos.length || s.bairros.length || s.quartosMin != null ||
       s.quartosMax != null || s.suitesMin != null || s.garagemMin != null ||
       s.precoMin != null || s.precoMax != null || s.areaMin != null ||
       s.areaMax != null || s.andar != null || s.ehTerreo ||
       s.caracteristicas.length || s.diasAtualizacao != null)
  );
  const suitesMin = useFiltersStore((s) => s.suitesMin);
  const garagemMin = useFiltersStore((s) => s.garagemMin);
  const ehTerreo = useFiltersStore((s) => s.ehTerreo);
  const diasAtualizacao = useFiltersStore((s) => s.diasAtualizacao);

  const panelContent = (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Filtros</h2>
        {temFiltrosAtivos && (
          <button
            onClick={limparFiltros}
            className="text-xs text-brand-600 hover:text-brand-800 font-medium"
          >
            Limpar tudo
          </button>
        )}
      </div>

      <TipoFilter tipos={opcoes?.tipos} />
      <BairroFilter bairros={opcoes?.bairros} />
      <QuartosFilter />
      <PrecoFilter />
      <AreaFilter />

      {/* Suítes */}
      <div>
        <label className="filter-label">Suítes</label>
        <select
          value={suitesMin ?? ""}
          onChange={(e) => setFiltro("suitesMin", e.target.value === "" ? null : Number(e.target.value))}
          className="filter-input"
        >
          {SUITES_OPT.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Garagem */}
      <div>
        <label className="filter-label">Vagas de garagem</label>
        <select
          value={garagemMin ?? ""}
          onChange={(e) => setFiltro("garagemMin", e.target.value === "" ? null : Number(e.target.value))}
          className="filter-input"
        >
          {GARAGEM_OPT.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Térreo */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={ehTerreo}
            onChange={(e) => setFiltro("ehTerreo", e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm text-gray-700">Somente térreo</span>
        </label>
      </div>

      <CaracteristicasFilter caracteristicas={opcoes?.caracteristicas} />

      {/* Atualização */}
      <div>
        <label className="filter-label">Atualizado</label>
        <select
          value={diasAtualizacao ?? ""}
          onChange={(e) => setFiltro("diasAtualizacao", e.target.value === "" ? null : Number(e.target.value))}
          className="filter-input"
        >
          {DIAS_OPT.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    </div>
  );

  return (
    <>
      {/* Sidebar desktop */}
      <aside className="hidden lg:block w-72 shrink-0">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 sticky top-4">
          {panelContent}
        </div>
      </aside>

      {/* Drawer mobile */}
      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={onClose} />
          <div className="relative ml-auto w-80 max-w-full h-full bg-white shadow-xl overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="font-semibold text-gray-800">Filtros</span>
              <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
                <svg className="h-5 w-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {panelContent}
            <div className="mt-6">
              <button onClick={onClose} className="btn-primary w-full text-center">
                Ver resultados
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
