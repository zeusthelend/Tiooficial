import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Btn, Field, Spinner } from "@/components/kit";
import { Activity, Lock } from "lucide-react";

export default function Login() {
  const { login, user, checking } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  if (!checking && user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    const res = await login(email.trim(), password);
    setLoading(false);
    if (res.ok) nav("/"); else setErr(res.error);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl grid place-items-center neon-ring bg-primary/10"><Activity className="w-6 h-6 text-primary" /></div>
          <span className="font-display text-xl font-bold">Shopping <span className="neon-text">Hospitalar</span></span>
        </div>
        <div className="max-w-md">
          <h1 className="font-display text-4xl lg:text-5xl font-bold leading-tight">Gestão empresarial<br /><span className="neon-text">em tempo real</span></h1>
          <p className="text-muted-foreground mt-4 text-base">Vendas, DAVs, estoque, comunicação e colaboração — tudo em uma plataforma segura e integrada.</p>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Shopping Hospitalar</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="glass card-panel w-full max-w-md p-7 rise" data-testid="login-form">
          <div className="lg:hidden flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl grid place-items-center neon-ring bg-primary/10"><Activity className="w-5 h-5 text-primary" /></div>
            <span className="font-display text-lg font-bold">Shopping <span className="neon-text">Hospitalar</span></span>
          </div>
          <h2 className="font-display text-2xl font-bold mb-1">Acessar sistema</h2>
          <p className="text-sm text-muted-foreground mb-6">Entre com seu e-mail corporativo.</p>
          <div className="space-y-4">
            <Field label="E-mail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" data-testid="login-email" />
            <Field label="Senha" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" data-testid="login-password" />
          </div>
          {err && <p className="mt-4 text-sm text-rose-400 flex items-center gap-2" data-testid="login-error"><Lock className="w-4 h-4" /> {err}</p>}
          <Btn type="submit" disabled={loading} className="w-full mt-6" data-testid="login-submit">
            {loading ? <Spinner className="w-4 h-4" /> : "Entrar"}
          </Btn>
        </form>
      </div>
    </div>
  );
}
