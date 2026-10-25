import { useEffect, useState } from "react";
import api, { apiError } from "@/lib/api";
import { Btn, Field, Modal, Spinner, EmptyState } from "@/components/kit";
import { toast } from "sonner";
import { Plus, Pencil, ShieldAlert, ShieldCheck, Ban } from "lucide-react";

const ROLES = [
  ["admin", "Administrador"], ["gerente", "Gerência"], ["encarregado", "Encarregado"],
  ["vendedor", "Vendedor"], ["estoque", "Estoque"], ["encarregado_estoque", "Enc. de Estoque"],
];
const STATUS = { ativo: ["Ativo", "text-emerald-400", ShieldCheck], suspenso: ["Suspenso", "text-amber-400", ShieldAlert], bloqueado: ["Bloqueado", "text-rose-400", Ban] };

export default function Funcionarios() {
  const [users, setUsers] = useState(null);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const load = async () => { const { data } = await api.get("/users"); setUsers(data.users); };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm({ role: "vendedor" }); setModal(true); };
  const openEdit = (u) => { setEditing(u); setForm({ name: u.name, role: u.role, status: u.status, phone: u.phone, password: "" }); setModal(true); };

  const save = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      if (editing) {
        const patch = { name: form.name, role: form.role, status: form.status, phone: form.phone };
        if (form.password) patch.password = form.password;
        await api.patch(`/users/${editing.id}`, patch);
        toast.success("Funcionário atualizado.");
      } else {
        await api.post("/users", { email: form.email, password: form.password, name: form.name, role: form.role, phone: form.phone });
        toast.success("Funcionário criado.");
      }
      setModal(false); load();
    } catch (e2) { toast.error(apiError(e2.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5" data-testid="funcionarios-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Funcionários</h1>
          <p className="text-muted-foreground text-sm mt-1">Gerencie acessos, cargos e status.</p>
        </div>
        <Btn onClick={openNew} data-testid="new-user-btn"><Plus className="w-4 h-4" /> Novo funcionário</Btn>
      </div>

      {!users ? (
        <div className="grid place-items-center py-16"><Spinner className="w-7 h-7 text-primary" /></div>
      ) : users.length === 0 ? (
        <EmptyState title="Nenhum funcionário" />
      ) : (
        <div className="glass card-panel overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="p-3 font-semibold">Nome</th>
                <th className="p-3 font-semibold">E-mail</th>
                <th className="p-3 font-semibold">Cargo</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const [slabel, scls, SIcon] = STATUS[u.status] || ["?", "", ShieldCheck];
                return (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-secondary/40" data-testid={`user-row-${u.email}`}>
                    <td className="p-3 font-semibold">{u.name}</td>
                    <td className="p-3 text-muted-foreground">{u.email}</td>
                    <td className="p-3">{ROLES.find((r) => r[0] === u.role)?.[1] || u.role}</td>
                    <td className="p-3"><span className={`inline-flex items-center gap-1.5 font-semibold ${scls}`}><SIcon className="w-4 h-4" />{slabel}</span></td>
                    <td className="p-3 text-right"><button onClick={() => openEdit(u)} className="p-2 rounded-lg hover:bg-secondary" data-testid={`user-edit-${u.email}`}><Pencil className="w-4 h-4" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? "Editar funcionário" : "Novo funcionário"} testid="user-modal">
        <form onSubmit={save} className="space-y-4">
          <Field label="Nome completo" required value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="user-name" />
          {!editing && <Field label="E-mail" type="email" required value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="user-email" />}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cargo" as="select" value={form.role || "vendedor"} onChange={(e) => setForm({ ...form, role: e.target.value })} data-testid="user-role">
              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Field>
            {editing && (
              <Field label="Status" as="select" value={form.status || "ativo"} onChange={(e) => setForm({ ...form, status: e.target.value })} data-testid="user-status">
                <option value="ativo">Ativo</option><option value="suspenso">Suspenso</option><option value="bloqueado">Bloqueado</option>
              </Field>
            )}
          </div>
          <Field label="Telefone" value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="user-phone" />
          <Field label={editing ? "Nova senha (opcional)" : "Senha"} type="password" required={!editing} value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="user-password" />
          <Btn type="submit" disabled={saving} className="w-full" data-testid="user-save">{saving ? <Spinner className="w-4 h-4" /> : "Salvar"}</Btn>
        </form>
      </Modal>
    </div>
  );
}
