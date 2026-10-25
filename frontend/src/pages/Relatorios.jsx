import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Btn, Spinner, StatusBadge, EmptyState } from "@/components/kit";
import { Download, Printer } from "lucide-react";

const SITUACOES = [
  ["", "Todas"], ["em_andamento", "Em andamento"], ["reservado", "Reservado"],
  ["desistiu", "Desistiu"], ["concluida", "Concluída"], ["vencido", "Vencido"],
];
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function Relatorios() {
  const [davs, setDavs] = useState(null);
  const [vendedores, setVendedores] = useState([]);
  const [filters, setFilters] = useState({ vendedor_id: "", situacao: "" });

  const load = async () => {
    const params = {};
    if (filters.vendedor_id) params.vendedor_id = filters.vendedor_id;
    if (filters.situacao) params.situacao = filters.situacao;
    const { data } = await api.get("/davs", { params });
    setDavs(data.davs);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters]);
  useEffect(() => { api.get("/users/vendedores").then(({ data }) => setVendedores(data.vendedores)).catch(() => {}); }, []);

  const total = (davs || []).reduce((s, d) => s + (d.situacao === "concluida" ? Number(d.valor || 0) : 0), 0);

  const exportCsv = () => {
    const rows = [["Numero", "Vendedor", "Categoria", "Vencimento", "Valor", "Situacao"]];
    (davs || []).forEach((d) => rows.push([d.numero, d.vendedor_nome || "", d.categoria, d.data_vencimento || "", d.valor || 0, d.situacao]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "relatorio_davs.csv"; a.click();
  };

  return (
    <div className="space-y-5" data-testid="relatorios-page">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Vendas & Relatórios</h1>
          <p className="text-muted-foreground text-sm mt-1">Consulte e exporte os dados reais do sistema.</p>
        </div>
        <div className="flex gap-2">
          <Btn variant="ghost" onClick={exportCsv} data-testid="export-csv"><Download className="w-4 h-4" /> CSV</Btn>
          <Btn variant="ghost" onClick={() => window.print()} data-testid="export-pdf"><Printer className="w-4 h-4" /> PDF</Btn>
        </div>
      </div>

      <div className="glass card-panel p-4 grid sm:grid-cols-2 gap-3 print:hidden">
        <select className="field" value={filters.vendedor_id} onChange={(e) => setFilters((f) => ({ ...f, vendedor_id: e.target.value }))} data-testid="rel-vendedor">
          <option value="">Todos os vendedores</option>
          {vendedores.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select className="field" value={filters.situacao} onChange={(e) => setFilters((f) => ({ ...f, situacao: e.target.value }))} data-testid="rel-situacao">
          {SITUACOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="glass card-panel p-5"><p className="text-xs uppercase text-muted-foreground font-semibold">Registros</p><p className="font-display text-3xl font-bold mt-2">{davs?.length ?? "—"}</p></div>
        <div className="glass card-panel p-5"><p className="text-xs uppercase text-muted-foreground font-semibold">Valor concluído</p><p className="font-display text-2xl font-bold mt-2 neon-text">{brl(total)}</p></div>
      </div>

      {!davs ? (
        <div className="grid place-items-center py-16"><Spinner className="w-7 h-7 text-primary" /></div>
      ) : davs.length === 0 ? (
        <EmptyState title="Sem registros para o filtro" />
      ) : (
        <div className="glass card-panel overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="p-3 font-semibold">Nº</th><th className="p-3 font-semibold">Vendedor</th>
                <th className="p-3 font-semibold">Categoria</th><th className="p-3 font-semibold">Vencimento</th>
                <th className="p-3 font-semibold">Valor</th><th className="p-3 font-semibold">Situação</th>
              </tr>
            </thead>
            <tbody>
              {davs.map((d) => (
                <tr key={d.id} className="border-b border-border/50">
                  <td className="p-3 font-semibold">{d.numero}</td>
                  <td className="p-3">{d.vendedor_nome || "—"}</td>
                  <td className="p-3 capitalize">{d.categoria}</td>
                  <td className="p-3">{d.data_vencimento || "—"}</td>
                  <td className="p-3">{brl(d.valor)}</td>
                  <td className="p-3"><StatusBadge value={d.situacao} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
