-- Shopping Hospitalar - Migration incremental e segura (Supabase)
-- Execute no Supabase > SQL Editor. Usa IF NOT EXISTS para preservar dados existentes.

create extension if not exists "pgcrypto";

-- Usuarios / Funcionarios
create table if not exists public.sh_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  name text not null,
  role text not null default 'vendedor',
  status text not null default 'ativo',
  pin_hash text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- DAVs (Documento Auxiliar de Venda)
create table if not exists public.sh_davs (
  id uuid primary key default gen_random_uuid(),
  numero text not null,
  vendedor_id uuid references public.sh_users(id),
  vendedor_nome text,
  categoria text not null default 'dav',
  data_inicial date,
  data_vencimento date,
  descricao text,
  valor numeric default 0,
  situacao text not null default 'em_andamento',
  anexo_url text,
  historico jsonb not null default '[]'::jsonb,
  created_by uuid references public.sh_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Estoque / Ocorrencias
create table if not exists public.sh_estoque (
  id uuid primary key default gen_random_uuid(),
  produto text not null,
  codigo text,
  quantidade numeric default 0,
  tipo text not null default 'avariado',
  descricao text,
  situacao text not null default 'aberta',
  responsavel_id uuid references public.sh_users(id),
  responsavel_nome text,
  foto_url text,
  data_ocorrencia date default now(),
  historico jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Notificacoes internas
create table if not exists public.sh_notificacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.sh_users(id),
  titulo text not null,
  mensagem text,
  tipo text default 'info',
  link text,
  lida boolean not null default false,
  created_at timestamptz not null default now()
);

-- Auditoria
create table if not exists public.sh_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  user_email text,
  acao text not null,
  detalhe text,
  created_at timestamptz not null default now()
);

-- O backend usa a Service Role Key (acesso de servidor confiavel), portanto o RLS e aplicado
-- na camada da API. Mantemos RLS habilitado e sem policies publicas por seguranca.
alter table public.sh_users enable row level security;
alter table public.sh_davs enable row level security;
alter table public.sh_estoque enable row level security;
alter table public.sh_notificacoes enable row level security;
alter table public.sh_audit enable row level security;
