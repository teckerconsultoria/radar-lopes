import { useState, useEffect, useRef } from "react";
import { buscarImoveis } from "../lib/queries";
import { useFiltersStore } from "../store/filters";

export function useImoveis() {
  const [imoveis, setImoveis] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  // Select each primitive individually — stable references, no new object each render
  const texto        = useFiltersStore((s) => s.texto);
  const tipos        = useFiltersStore((s) => s.tipos);
  const bairros      = useFiltersStore((s) => s.bairros);
  const quartosMin   = useFiltersStore((s) => s.quartosMin);
  const quartosMax   = useFiltersStore((s) => s.quartosMax);
  const suitesMin    = useFiltersStore((s) => s.suitesMin);
  const garagemMin   = useFiltersStore((s) => s.garagemMin);
  const precoMin     = useFiltersStore((s) => s.precoMin);
  const precoMax     = useFiltersStore((s) => s.precoMax);
  const areaMin      = useFiltersStore((s) => s.areaMin);
  const areaMax      = useFiltersStore((s) => s.areaMax);
  const andar        = useFiltersStore((s) => s.andar);
  const ehTerreo     = useFiltersStore((s) => s.ehTerreo);
  const caracteristicas = useFiltersStore((s) => s.caracteristicas);
  const diasAtualizacao = useFiltersStore((s) => s.diasAtualizacao);
  const sortBy       = useFiltersStore((s) => s.sortBy);

  useEffect(() => {
    const filters = {
      texto, tipos, bairros, quartosMin, quartosMax, suitesMin, garagemMin,
      precoMin, precoMax, areaMin, areaMax, andar, ehTerreo,
      caracteristicas, diasAtualizacao,
    };
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      const { data, count: total, error: err } = await buscarImoveis(filters, sortBy);
      setImoveis(data);
      setCount(total);
      setError(err);
      setLoading(false);
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [texto, JSON.stringify(tipos), JSON.stringify(bairros), quartosMin, quartosMax,
      suitesMin, garagemMin, precoMin, precoMax, areaMin, areaMax, andar, ehTerreo,
      JSON.stringify(caracteristicas), diasAtualizacao, sortBy]);

  return { imoveis, count, loading, error };
}
