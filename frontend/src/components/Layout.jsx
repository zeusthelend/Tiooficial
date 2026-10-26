import { useEffect, useState } from "react";
import { NavLink, useNavigate, Outlet } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  LayoutDashboard, FileText, Boxes, Users, BarChart3, Bot, Bell, LogOut, Menu, X, Activity, MessageCircle,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Painel", icon: LayoutDashboard, roles: "*" },
  { to: "/davs", label: "DAVs", icon: FileText, roles: "*" },
  { to: "/relatorios", label: "Vendas & Relatórios", icon: BarChart3, roles: ["admin", "gerente", "encarregado"] },
  { to: "/estoque", label: "Estoque & Ocorrências", icon: Boxes, roles: ["admin", "gerente", "encarregado", "estoque", "encarregado_estoque"] },
  { to: "/funcionarios", label: "Funcionários", icon: Users, roles: ["admin"] },
  { to: "/assistente", label: "Assistente IA", icon: Bot, roles: "*" },
  { to: "/comunicacao", label: "Chat e chamadas", icon: MessageCircle, roles: "*" },
  { to: "/notificacoes", label: "Notificações", icon: Bell, roles: "*" },
];

const ROLE_LABEL = {
  admin: "Administrador", gerente: "Gerência", encarregado: "Encarregado",
  vendedor: "Vendedor", estoque: "Estoque", encarregado_estoque: "Enc. Estoque",
};

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try { const { data } = await api.get("/notificacoes"); if (active) setUnread(data.nao_lidas); } catch {}
    };
    poll();
    const id = setInterval(poll, 30000);
    return () => { active = false; clearInterval(id); };
  }, []);

  const items = NAV.filter((n) => n.roles === "*" || n.roles.includes(user.role));

  const doLogout = async () => { await logout(); nav("/login"); };

  const SideItem = ({ n }) => (
    <NavLink
      to={n.to} end={n.to === "/"}
      data-testid={`nav-${n.label.toLowerCase().replace(/[^a-z]/g, "-")}`}
      onClick={() => setOpen(false)}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
          isActive ? "bg-primary/15 text-primary neon-ring" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
        }`
      }
    >
      <n.icon className="w-[18px] h-[18px]" />
      <span className="flex-1">{n.label}</span>
      {n.to === "/notificacoes" && unread > 0 && (
        <span className="badge bg-primary text-primary-foreground">{unread}</span>
      )}
    </NavLink>
  );

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className={`fixed lg:static z-40 h-full w-72 glass p-4 flex flex-col transition-transform ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <div className="flex items-center gap-3 px-2 py-3 mb-4">
          <div className="w-10 h-10 rounded-xl grid place-items-center neon-ring bg-primary/10">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-display font-bold leading-tight">Shopping</p>
            <p className="neon-text font-display text-sm font-bold leading-tight">Hospitalar</p>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setOpen(false)}><X className="w-5 h-5" /></button>
        </div>
        <nav className="flex-1 space-y-1.5 overflow-y-auto">
          {items.map((n) => <SideItem key={n.to} n={n} />)}
        </nav>
        <div className="pt-3 border-t border-border mt-3">
          <div className="px-2 py-2">
            <p className="text-sm font-semibold truncate">{user.name}</p>
            <p className="text-xs text-primary">{ROLE_LABEL[user.role] || user.role}</p>
          </div>
          <button data-testid="logout-btn" onClick={doLogout} className="btn-ghost w-full justify-center flex items-center gap-2">
            <LogOut className="w-4 h-4" /> Sair
          </button>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden glass flex items-center gap-3 px-4 py-3 sticky top-0 z-20">
          <button data-testid="menu-btn" onClick={() => setOpen(true)}><Menu className="w-6 h-6" /></button>
          <span className="font-display font-bold">Shopping <span className="neon-text">Hospitalar</span></span>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
