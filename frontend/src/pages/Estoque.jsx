import { useEffect, useState } from "react";
import api, { apiError } from "@/lib/api";
import { Btn, Field, Modal, Spinner, StatusBadge, EmptyState } from "@/components/kit";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";

const TIPOS = [
  ["avariado", "Produto avariado"], ["vencido", "Produto vencido"],
  ["recebido_sem_entrada", "Recebido sem entrada"], ["outro", "Outra ocorrência"],
];
const SIT = [["aberta", "Aberta"], ["em_andamento", "Em andamento"], ["resolvida", "Resolvida"]];

export default function Estoque() {
  const [items, setItems] = useState(null);
  const [filters, setFilters] = useState({ situacao: "", tipo: "" });
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const params = {};
    if (filters.situacao) params.situacao = filters.situacao;
    if (filters.tipo) params.tipo = filters.tipo;
    const { data } = await api.get("/estoque", { params });
    setItems(data.ocorrencias);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters.situacao, filters.tipo]);

  const openNew = () => { setEditing(null); setForm({ tipo: "avariado", situacao: "aberta", quantidade: 1 }); setModal(true); };
  const openEdit = (o) => { setEditing(o); setForm({ ...o }); setModal(true); };

  const save = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      if (editing) {
        await api.patch(`/estoque/${editing.id}`, {
          produto: form.produto, codigo: form.codigo, quantidade: Number(form.quantidade) || 0,
          tipo: form.tipo, descricao: form.descricao, situacao: form.situacao,
        });
        toast.success("Ocorrência atualizada.");
      } else {
        await api.post("/estoque", {
          produto: form.produto, codigo: form.codigo, quantidade: Number(form.quantidade) || 0,
          tipo: form.tipo, descricao: form.descricao, situacao: form.situacao,
        });
        toast.success("Ocorrência registrada.");
      }
      setModal(false); load();
    } catch (e2) { toast.error(apiError(e2.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5" data-testid="estoque-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Estoque & Ocorrências</h1>
          <p className="text-muted-foreground text-sm mt-1">Registro de avarias, vencimentos e recebimentos.</p>
        </div>
        <Btn onClick={openNew} data-testid="new-ocorrencia-btn"><Plus className="w-4 h-4" /> Nova ocorrência</Btn>
      </div>

      <div className="glass card-panel p-4 grid sm:grid-cols-2 gap-3">
        <select className="field" value={filters.tipo} onChange={(e) => setFilters((f) => ({ ...f, tipo: e.target.value }))} data-testid="est-filter-tipo">
          <option value="">Todos os tipos</option>
          {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="field" value={filters.situacao} onChange={(e) => setFilters((f) => ({ ...f, situacao: e.target.value }))} data-testid="est-filter-sit">
          <option value="">Todas as situações</option>
          {SIT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {!items ? (
        <div className="grid place-items-center py-16"><Spinner className="w-7 h-7 text-primary" /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhuma ocorrência" hint="Registre a primeira ocorrência de estoque." />
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((o) => (
            <div key={o.id} className="glass card-panel p-4 rise" data-testid={`ocorrencia-${o.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{o.produto}</p>
                  <p className="text-xs text-muted-foreground">{o.codigo ? `Cód. ${o.codigo} • ` : ""}Qtd {o.quantidade}</p>
                </div>
                <StatusBadge value={o.situacao} />
              </div>
              <p className="text-xs mt-3 inline-flex badge bg-secondary text-muted-foreground">{TIPOS.find((t) => t[0] === o.tipo)?.[1] || o.tipo}</p>
              {o.descricao && <p className="text-sm text-muted-foreground mt-2 line-clamp-3">{o.descricao}</p>}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/60">
                <span className="text-xs text-muted-foreground">{o.responsavel_nome} • {o.data_ocorrencia}</span>
                <button onClick={() => openEdit(o)} className="p-1.5 rounded-lg hover:bg-secondary" data-testid={`ocorrencia-edit-${o.id}`}><Pencil className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? "Editar ocorrência" : "Nova ocorrência"} testid="estoque-modal">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Produto" required value={form.produto || ""} onChange={(e) => setForm({ ...form, produto: e.target.value })} data-testid="est-produto" />
            <Field label="Código" value={form.codigo || ""} onChange={(e) => setForm({ ...form, codigo: e.target.value })} data-testid="est-codigo" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantidade" type="number" value={form.quantidade ?? 1} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} data-testid="est-qtd" />
            <Field label="Tipo" as="select" value={form.tipo || "avariado"} onChange={(e) => setForm({ ...form, tipo: e.target.value })} data-testid="est-tipo">
              {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Field>
          </div>
          <Field label="Situação" as="select" value={form.situacao || "aberta"} onChange={(e) => setForm({ ...form, situacao: e.target.value })} data-testid="est-situacao">
            {SIT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Field>
          <Field label="Descrição" as="textarea" rows={3} value={form.descricao || ""} onChange={(e) => setForm({ ...form, descricao: e.target.value })} data-testid="est-descricao" />
          <Btn type="submit" disabled={saving} className="w-full" data-testid="est-save">{saving ? <Spinner className="w-4 h-4" /> : "Salvar"}</Btn>
        </form>
      </Modal>
    </div>
  );
}
