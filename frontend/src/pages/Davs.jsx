import { useEffect, useMemo, useState } from "react";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Btn, Field, Modal, Spinner, StatusBadge, EmptyState } from "@/components/kit";
import { toast } from "sonner";
import { Plus, Search, History, Trash2, Pencil } from "lucide-react";

// Values must match the FastAPI/Supabase API contract.
const SITUACOES = [
  ["aberto", "Aberto"], ["em_andamento", "Em andamento"],
  ["concluido", "Venda concluída"], ["cancelado", "Cancelado"],
];
const CATEGORIAS = [["dav", "DAV"], ["prefeitura", "Prefeitura"], ["reservado", "Reservado"]];

export default function Davs() {
  const { user } = useAuth();
  const canManageOthers = Boolean(user.is_manager || user.can_stock);
  const [davs, setDavs] = useState(null);
  const [vendedores, setVendedores] = useState([]);
  const [filters, setFilters] = useState({ situacao: "", categoria: "", q: "" });
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [histFor, setHistFor] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const params = {};
    if (filters.situacao) params.status = filters.situacao;
    if (filters.categoria) params.category = filters.categoria;
    if (filters.q) params.q = filters.q;
    const { data } = await api.get("/davs", { params });
    // Normalize backend field names to the view model used by this page.
    setDavs((data.davs || []).map((d) => ({
      ...d,
      numero: d.dav_number,
      vendedor_id: d.seller_id,
      vendedor_nome: d.seller_name,
      data_vencimento: d.due_at,
      valor: d.dav_value,
      situacao: d.status,
      descricao: d.description,
      historico: d.historico || [],
    })));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters.situacao, filters.categoria]);
  useEffect(() => {
    if (canManageOthers) api.get("/users/vendedores").then(({ data }) => setVendedores(data.vendedores)).catch(() => {});
  }, [canManageOthers]);

  const openNew = () => { setEditing(null); setForm({ categoria: "dav", situacao: "aberto", valor: 0 }); setModal(true); };
  const openEdit = (d) => { setEditing(d); setForm({ ...d }); setModal(true); };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/davs/${editing.id}`, {
          dav_number: form.numero, category: form.categoria, status: form.situacao,
          description: form.descricao, dav_value: Number(form.valor) || 0,
          due_at: form.data_vencimento || null,
        });
        toast.success("DAV atualizado.");
      } else {
        await api.post("/davs", {
          dav_number: form.numero, category: form.categoria, status: form.situacao,
          description: form.descricao, dav_value: Number(form.valor) || 0,
          seller_id: canManageOthers ? form.vendedor_id : undefined,
          due_at: form.data_vencimento || null,
        });
        toast.success("DAV criado.");
      }
      setModal(false); load();
    } catch (e2) {
      toast.error(apiError(e2.response?.data?.detail));
    } finally { setSaving(false); }
  };

  const remove = async (d) => {
    if (!window.confirm(`Excluir o DAV ${d.numero}? Esta ação não pode ser desfeita.`)) return;
    const pin = window.prompt("Informe o PIN de segurança para excluir este DAV:");
    if (!pin) return;
    try { await api.delete(`/davs/${d.id}`, { params: { pin } }); toast.success("DAV excluído."); load(); }
    catch (e) { toast.error(apiError(e.response?.data?.detail)); }
  };

  return (
    <div className="space-y-5" data-testid="davs-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">DAVs</h1>
          <p className="text-muted-foreground text-sm mt-1">Documentos Auxiliares de Venda.</p>
        </div>
        <Btn onClick={openNew} data-testid="new-dav-btn"><Plus className="w-4 h-4" /> Novo DAV</Btn>
      </div>

      <div className="glass card-panel p-4 grid sm:grid-cols-4 gap-3">
        <div className="relative sm:col-span-2">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="field pl-9" placeholder="Pesquisar nº do DAV" value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && load()} data-testid="dav-search" />
        </div>
        <select className="field" value={filters.situacao} onChange={(e) => setFilters((f) => ({ ...f, situacao: e.target.value }))} data-testid="dav-filter-situacao">
          <option value="">Todas as situações</option>
          {SITUACOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="field" value={filters.categoria} onChange={(e) => setFilters((f) => ({ ...f, categoria: e.target.value }))} data-testid="dav-filter-categoria">
          <option value="">Todas as abas</option>
          {CATEGORIAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {!davs ? (
        <div className="grid place-items-center py-16"><Spinner className="w-7 h-7 text-primary" /></div>
      ) : davs.length === 0 ? (
        <EmptyState title="Nenhum DAV encontrado" hint="Crie um novo DAV ou ajuste os filtros." />
      ) : (
        <div className="glass card-panel overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="p-3 font-semibold">Nº</th>
                <th className="p-3 font-semibold">Vendedor</th>
                <th className="p-3 font-semibold">Categoria</th>
                <th className="p-3 font-semibold">Vencimento</th>
                <th className="p-3 font-semibold">Valor</th>
                <th className="p-3 font-semibold">Situação</th>
                <th className="p-3 font-semibold text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {davs.map((d) => (
                <tr key={d.id} className="border-b border-border/50 hover:bg-secondary/40" data-testid={`dav-row-${d.numero}`}>
                  <td className="p-3 font-semibold">{d.numero}</td>
                  <td className="p-3">{d.vendedor_nome || "—"}</td>
                  <td className="p-3 capitalize">{d.categoria}</td>
                  <td className="p-3">{d.data_vencimento || "—"}</td>
                  <td className="p-3">{Number(d.valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
                  <td className="p-3"><StatusBadge value={d.situacao} /></td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => setHistFor(d)} className="p-2 rounded-lg hover:bg-secondary" title="Histórico" data-testid={`dav-hist-${d.numero}`}><History className="w-4 h-4" /></button>
                      <button onClick={() => openEdit(d)} className="p-2 rounded-lg hover:bg-secondary" title="Editar" data-testid={`dav-edit-${d.numero}`}><Pencil className="w-4 h-4" /></button>
                      {user.role === "admin" && <button onClick={() => remove(d)} className="p-2 rounded-lg hover:bg-secondary text-rose-400" title="Excluir" data-testid={`dav-del-${d.numero}`}><Trash2 className="w-4 h-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? "Editar DAV" : "Novo DAV"} testid="dav-modal">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Número do DAV" required value={form.numero || ""} onChange={(e) => setForm({ ...form, numero: e.target.value })} data-testid="dav-numero" />
            <Field label="Categoria" as="select" value={form.categoria || "dav"} onChange={(e) => setForm({ ...form, categoria: e.target.value })} data-testid="dav-categoria">
              {CATEGORIAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Field>
          </div>
          {canManageOthers && !editing && (
            <Field label="Vendedor responsável" as="select" required value={form.vendedor_id || ""} onChange={(e) => setForm({ ...form, vendedor_id: e.target.value })} data-testid="dav-vendedor">
              <option value="">Selecione o vendedor</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data inicial" type="date" value={form.data_inicial || ""} onChange={(e) => setForm({ ...form, data_inicial: e.target.value })} data-testid="dav-data-inicial" />
            <Field label="Vencimento" type="date" value={form.data_vencimento || ""} onChange={(e) => setForm({ ...form, data_vencimento: e.target.value })} data-testid="dav-data-venc" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor (R$)" type="number" step="0.01" value={form.valor ?? 0} onChange={(e) => setForm({ ...form, valor: e.target.value })} data-testid="dav-valor" />
            <Field label="Situação" as="select" value={form.situacao || "em_andamento"} onChange={(e) => setForm({ ...form, situacao: e.target.value })} data-testid="dav-situacao">
              {SITUACOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Field>
          </div>
          <Field label="Descrição / observações" as="textarea" rows={3} value={form.descricao || ""} onChange={(e) => setForm({ ...form, descricao: e.target.value })} data-testid="dav-descricao" />
          <Btn type="submit" disabled={saving} className="w-full" data-testid="dav-save">{saving ? <Spinner className="w-4 h-4" /> : "Salvar DAV"}</Btn>
        </form>
      </Modal>

      <Modal open={!!histFor} onClose={() => setHistFor(null)} title={`Histórico — DAV ${histFor?.numero || ""}`} testid="dav-hist-modal">
        <div className="space-y-3">
          {(histFor?.historico || []).length === 0 && <p className="text-sm text-muted-foreground">Sem alterações registradas.</p>}
          {(histFor?.historico || []).slice().reverse().map((h, i) => (
            <div key={i} className="flex gap-3 text-sm">
              <div className="w-2 h-2 mt-1.5 rounded-full bg-primary shrink-0" />
              <div>
                <p className="font-medium">{h.acao}</p>
                <p className="text-xs text-muted-foreground">{h.por} • {h.em ? new Date(h.em).toLocaleString("pt-BR") : ""}</p>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
