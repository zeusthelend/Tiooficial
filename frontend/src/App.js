import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Spinner } from "@/components/kit";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Davs from "@/pages/Davs";
import Estoque from "@/pages/Estoque";
import Funcionarios from "@/pages/Funcionarios";
import Relatorios from "@/pages/Relatorios";
import Assistente from "@/pages/Assistente";
import Notificacoes from "@/pages/Notificacoes";

function Gate({ children }) {
  const { user, checking } = useAuth();
  if (checking) return <div className="min-h-screen grid place-items-center"><Spinner className="w-8 h-8 text-primary" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <Toaster theme="dark" position="top-right" richColors />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Gate><Layout /></Gate>}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/davs" element={<Davs />} />
              <Route path="/relatorios" element={<Relatorios />} />
              <Route path="/estoque" element={<Estoque />} />
              <Route path="/funcionarios" element={<Funcionarios />} />
              <Route path="/assistente" element={<Assistente />} />
              <Route path="/notificacoes" element={<Notificacoes />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
