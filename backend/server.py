from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import logging
import time
import jwt
import bcrypt
from datetime import datetime, timezone, timedelta, date
from typing import Optional, List

from fastapi import FastAPI, APIRouter, Request, Response, HTTPException, Depends, Query
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row
from psycopg.types.json import Json

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("shopping_hospitalar")

pool = ConnectionPool(os.environ["SUPABASE_DB_URL"], min_size=1, max_size=5,
                      kwargs={"row_factory": dict_row}, open=True)

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

ROLES = ["admin", "gerente", "encarregado", "vendedor", "estoque", "encarregado_estoque"]
MANAGEMENT = ["admin", "gerente", "encarregado"]
STOCK_ROLES = ["admin", "gerente", "encarregado", "estoque", "encarregado_estoque"]

DDL = [
    'create extension if not exists "pgcrypto";',
    '''create table if not exists public.sh_users (
        id uuid primary key default gen_random_uuid(), email text unique not null,
        password_hash text not null, name text not null, role text not null default 'vendedor',
        status text not null default 'ativo', pin_hash text, phone text,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now());''',
    '''create table if not exists public.sh_davs (
        id uuid primary key default gen_random_uuid(), numero text not null,
        vendedor_id uuid references public.sh_users(id), vendedor_nome text,
        categoria text not null default 'dav', data_inicial date, data_vencimento date,
        descricao text, valor numeric default 0, situacao text not null default 'em_andamento',
        anexo_url text, historico jsonb not null default '[]'::jsonb,
        created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());''',
    '''create table if not exists public.sh_estoque (
        id uuid primary key default gen_random_uuid(), produto text not null, codigo text,
        quantidade numeric default 0, tipo text not null default 'avariado', descricao text,
        situacao text not null default 'aberta', responsavel_id uuid, responsavel_nome text,
        foto_url text, data_ocorrencia date default now(), historico jsonb not null default '[]'::jsonb,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now());''',
    '''create table if not exists public.sh_notificacoes (
        id uuid primary key default gen_random_uuid(), user_id uuid, titulo text not null,
        mensagem text, tipo text default 'info', link text, lida boolean not null default false,
        created_at timestamptz not null default now());''',
    '''create table if not exists public.sh_audit (
        id uuid primary key default gen_random_uuid(), user_id uuid, user_email text,
        acao text not null, detalhe text, created_at timestamptz not null default now());''',
]

def q(sql, params=None, fetch="all"):
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            if fetch == "all":
                return cur.fetchall()
            if fetch == "one":
                return cur.fetchone()
            return None

app = FastAPI(title="Shopping Hospitalar API")
api = APIRouter(prefix="/api")

# ----------------- helpers -----------------
def hash_secret(raw: str) -> str:
    return bcrypt.hashpw(raw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_secret(raw: str, hashed: Optional[str]) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(raw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

def create_access_token(uid: str, email: str, role: str) -> str:
    payload = {"sub": str(uid), "email": email, "role": role, "type": "access",
               "exp": datetime.now(timezone.utc) + timedelta(hours=12)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def set_auth_cookie(response: Response, token: str):
    response.set_cookie(key="access_token", value=token, httponly=True, secure=True,
                        samesite="none", max_age=43200, path="/")

def public_user(u: dict) -> dict:
    return {k: v for k, v in u.items() if k not in ("password_hash", "pin_hash")}

def audit(user: Optional[dict], acao: str, detalhe: str = ""):
    try:
        q("insert into sh_audit (user_id, user_email, acao, detalhe) values (%s,%s,%s,%s)",
          (user.get("id") if user else None, user.get("email") if user else None, acao, detalhe), fetch=None)
    except Exception as e:
        logger.warning(f"audit falhou: {e}")

def notify(user_id, titulo, mensagem, tipo="info", link=None):
    try:
        q("insert into sh_notificacoes (user_id, titulo, mensagem, tipo, link) values (%s,%s,%s,%s,%s)",
          (user_id, titulo, mensagem, tipo, link), fetch=None)
    except Exception as e:
        logger.warning(f"notify falhou: {e}")

_attempts = {}
def check_lock(key):
    rec = _attempts.get(key)
    if rec and rec["count"] >= 5 and time.time() - rec["ts"] < 900:
        raise HTTPException(status_code=429, detail="Muitas tentativas. Tente novamente em 15 minutos.")

def fail_attempt(key):
    rec = _attempts.get(key, {"count": 0, "ts": time.time()})
    rec["count"] += 1
    rec["ts"] = time.time()
    _attempts[key] = rec

def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Nao autenticado")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessao expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token invalido")
    user = q("select * from sh_users where id=%s", (payload["sub"],), fetch="one")
    if not user:
        raise HTTPException(status_code=401, detail="Usuario nao encontrado")
    if user["status"] == "bloqueado":
        raise HTTPException(status_code=403, detail="Acesso bloqueado. Contate o administrador.")
    if user["status"] == "suspenso":
        raise HTTPException(status_code=403, detail="Funcionario suspenso.")
    return user

def require_roles(user, roles):
    if user["role"] not in roles:
        raise HTTPException(status_code=403, detail="Voce nao tem permissao para esta acao.")

def hist_entry(user, acao):
    return {"acao": acao, "por": user["name"], "em": datetime.now(timezone.utc).isoformat()}

# ----------------- Models -----------------
class LoginIn(BaseModel):
    email: EmailStr
    password: str

class PinIn(BaseModel):
    pin: str

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "vendedor"
    phone: Optional[str] = None

class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None
    phone: Optional[str] = None
    password: Optional[str] = None

class DavIn(BaseModel):
    numero: str
    vendedor_id: Optional[str] = None
    categoria: str = "dav"
    data_inicial: Optional[str] = None
    data_vencimento: Optional[str] = None
    descricao: Optional[str] = None
    valor: float = 0
    situacao: str = "em_andamento"
    anexo_url: Optional[str] = None

class DavUpdate(BaseModel):
    numero: Optional[str] = None
    categoria: Optional[str] = None
    data_inicial: Optional[str] = None
    data_vencimento: Optional[str] = None
    descricao: Optional[str] = None
    valor: Optional[float] = None
    situacao: Optional[str] = None
    anexo_url: Optional[str] = None

class EstoqueIn(BaseModel):
    produto: str
    codigo: Optional[str] = None
    quantidade: float = 0
    tipo: str = "avariado"
    descricao: Optional[str] = None
    situacao: str = "aberta"
    foto_url: Optional[str] = None
    data_ocorrencia: Optional[str] = None

class EstoqueUpdate(BaseModel):
    produto: Optional[str] = None
    codigo: Optional[str] = None
    quantidade: Optional[float] = None
    tipo: Optional[str] = None
    descricao: Optional[str] = None
    situacao: Optional[str] = None
    foto_url: Optional[str] = None

class AiIn(BaseModel):
    message: str

# ----------------- Auth -----------------
@api.get("/")
def root():
    return {"app": "Shopping Hospitalar", "status": "ok"}

@api.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response):
    email = body.email.lower().strip()
    key = f"{request.client.host}:{email}"
    check_lock(key)
    user = q("select * from sh_users where email=%s", (email,), fetch="one")
    if not user or not verify_secret(body.password, user["password_hash"]):
        fail_attempt(key)
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")
    if user["status"] == "bloqueado":
        raise HTTPException(status_code=403, detail="Acesso bloqueado. Contate o administrador.")
    if user["status"] == "suspenso":
        raise HTTPException(status_code=403, detail="Funcionario suspenso. Contate o administrador.")
    _attempts.pop(key, None)
    token = create_access_token(user["id"], user["email"], user["role"])
    set_auth_cookie(response, token)
    audit(user, "login", "login efetuado")
    return {"user": public_user(user), "token": token}

@api.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}

@api.get("/auth/me")
def me(user: dict = Depends(get_current_user)):
    return {"user": public_user(user)}

@api.post("/auth/pin/set")
def set_pin(body: PinIn, user: dict = Depends(get_current_user)):
    if not body.pin.isdigit() or len(body.pin) < 4:
        raise HTTPException(status_code=400, detail="PIN deve ter ao menos 4 digitos.")
    q("update sh_users set pin_hash=%s, updated_at=now() where id=%s", (hash_secret(body.pin), user["id"]), fetch=None)
    audit(user, "pin_set", "PIN definido")
    return {"ok": True}

@api.post("/auth/pin/verify")
def verify_pin(body: PinIn, user: dict = Depends(get_current_user)):
    key = f"pin:{user['id']}"
    check_lock(key)
    if not verify_secret(body.pin, user.get("pin_hash")):
        fail_attempt(key)
        audit(user, "pin_fail", "PIN incorreto")
        raise HTTPException(status_code=401, detail="PIN incorreto.")
    _attempts.pop(key, None)
    audit(user, "pin_ok", "PIN validado")
    return {"ok": True}

# ----------------- Funcionarios -----------------
@api.get("/users")
def list_users(user: dict = Depends(get_current_user)):
    require_roles(user, MANAGEMENT + ["estoque", "encarregado_estoque"])
    rows = q("select id,email,name,role,status,phone,created_at from sh_users order by created_at")
    return {"users": rows}

@api.get("/users/vendedores")
def list_vendedores(user: dict = Depends(get_current_user)):
    rows = q("select id,name,email,role from sh_users where role in ('vendedor','encarregado') and status='ativo' order by name")
    return {"vendedores": rows}

@api.post("/users")
def create_user(body: UserCreate, user: dict = Depends(get_current_user)):
    require_roles(user, ["admin"])
    if body.role not in ROLES:
        raise HTTPException(status_code=400, detail="Cargo invalido.")
    email = body.email.lower().strip()
    if q("select id from sh_users where email=%s", (email,), fetch="one"):
        raise HTTPException(status_code=409, detail="Ja existe um usuario com este e-mail.")
    row = q("""insert into sh_users (email,password_hash,name,role,status,phone)
               values (%s,%s,%s,%s,'ativo',%s) returning *""",
            (email, hash_secret(body.password), body.name, body.role, body.phone), fetch="one")
    audit(user, "user_create", f"criou {email} ({body.role})")
    return {"user": public_user(row)}

@api.patch("/users/{uid}")
def update_user(uid: str, body: UserUpdate, user: dict = Depends(get_current_user)):
    require_roles(user, ["admin"])
    data = body.model_dump(exclude_none=True)
    if "role" in data and data["role"] not in ROLES:
        raise HTTPException(status_code=400, detail="Cargo invalido.")
    if "status" in data and data["status"] not in ("ativo", "suspenso", "bloqueado"):
        raise HTTPException(status_code=400, detail="Status invalido.")
    sets, vals = [], []
    for col in ("name", "role", "status", "phone"):
        if col in data:
            sets.append(f"{col}=%s"); vals.append(data[col])
    if "password" in data:
        sets.append("password_hash=%s"); vals.append(hash_secret(data["password"]))
    if not sets:
        raise HTTPException(status_code=400, detail="Nada para atualizar.")
    sets.append("updated_at=now()")
    vals.append(uid)
    row = q(f"update sh_users set {', '.join(sets)} where id=%s returning *", tuple(vals), fetch="one")
    if not row:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    audit(user, "user_update", f"atualizou {uid}")
    return {"user": public_user(row)}

# ----------------- DAVs -----------------
@api.get("/davs")
def list_davs(user: dict = Depends(get_current_user),
              situacao: Optional[str] = None, categoria: Optional[str] = None,
              vendedor_id: Optional[str] = None, q: Optional[str] = Query(None)):
    where, vals = [], []
    if user["role"] == "vendedor":
        where.append("vendedor_id=%s"); vals.append(user["id"])
    elif vendedor_id:
        where.append("vendedor_id=%s"); vals.append(vendedor_id)
    if situacao:
        where.append("situacao=%s"); vals.append(situacao)
    if categoria:
        where.append("categoria=%s"); vals.append(categoria)
    if q:
        where.append("numero ilike %s"); vals.append(f"%{q}%")
    clause = (" where " + " and ".join(where)) if where else ""
    rows = q(f"select * from sh_davs{clause} order by created_at desc", tuple(vals))
    return {"davs": rows}

@api.post("/davs")
def create_dav(body: DavIn, user: dict = Depends(get_current_user)):
    require_roles(user, MANAGEMENT + ["vendedor", "estoque", "encarregado_estoque"])
    vendedor_id = user["id"] if user["role"] == "vendedor" else body.vendedor_id
    if not vendedor_id:
        raise HTTPException(status_code=400, detail="Selecione o vendedor responsavel.")
    if q("select id from sh_davs where numero=%s and vendedor_id=%s", (body.numero, vendedor_id), fetch="one"):
        raise HTTPException(status_code=409, detail="Ja existe um DAV com este numero para este vendedor.")
    vend = q("select name from sh_users where id=%s", (vendedor_id,), fetch="one")
    vend_nome = vend["name"] if vend else None
    row = q("""insert into sh_davs (numero,vendedor_id,vendedor_nome,categoria,data_inicial,data_vencimento,
               descricao,valor,situacao,historico,created_by)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning *""",
            (body.numero, vendedor_id, vend_nome, body.categoria, body.data_inicial or None,
             body.data_vencimento or None, body.descricao, body.valor, body.situacao,
             Json([hist_entry(user, f"DAV criado ({body.situacao})")]), user["id"]), fetch="one")
    if str(vendedor_id) != str(user["id"]):
        notify(vendedor_id, "Novo DAV atribuido", f"O DAV {body.numero} foi incluido no seu perfil por {user['name']}.", "dav", "/davs")
    audit(user, "dav_create", f"DAV {body.numero} p/ {vend_nome}")
    return {"dav": row}

@api.patch("/davs/{did}")
def update_dav(did: str, body: DavUpdate, user: dict = Depends(get_current_user)):
    dav = q("select * from sh_davs where id=%s", (did,), fetch="one")
    if not dav:
        raise HTTPException(status_code=404, detail="DAV nao encontrado.")
    if user["role"] == "vendedor" and str(dav["vendedor_id"]) != str(user["id"]):
        raise HTTPException(status_code=403, detail="Voce so pode alterar seus proprios DAVs.")
    data = body.model_dump(exclude_none=True)
    hist = dav.get("historico") or []
    if "situacao" in data and data["situacao"] != dav["situacao"]:
        hist.append(hist_entry(user, f"Situacao: {dav['situacao']} -> {data['situacao']}"))
    else:
        hist.append(hist_entry(user, "DAV atualizado"))
    sets, vals = [], []
    for col in ("numero", "categoria", "data_inicial", "data_vencimento", "descricao", "valor", "situacao", "anexo_url"):
        if col in data:
            sets.append(f"{col}=%s"); vals.append(data[col] if data[col] != "" else None)
    sets.append("historico=%s"); vals.append(Json(hist))
    sets.append("updated_at=now()")
    vals.append(did)
    row = q(f"update sh_davs set {', '.join(sets)} where id=%s returning *", tuple(vals), fetch="one")
    audit(user, "dav_update", f"DAV {dav['numero']}")
    return {"dav": row}

@api.delete("/davs/{did}")
def delete_dav(did: str, user: dict = Depends(get_current_user)):
    require_roles(user, ["admin"])
    q("delete from sh_davs where id=%s", (did,), fetch=None)
    audit(user, "dav_delete", did)
    return {"ok": True}

# ----------------- Estoque -----------------
@api.get("/estoque")
def list_estoque(user: dict = Depends(get_current_user), situacao: Optional[str] = None, tipo: Optional[str] = None):
    require_roles(user, STOCK_ROLES)
    where, vals = [], []
    if situacao:
        where.append("situacao=%s"); vals.append(situacao)
    if tipo:
        where.append("tipo=%s"); vals.append(tipo)
    clause = (" where " + " and ".join(where)) if where else ""
    rows = q(f"select * from sh_estoque{clause} order by created_at desc", tuple(vals))
    return {"ocorrencias": rows}

@api.post("/estoque")
def create_estoque(body: EstoqueIn, user: dict = Depends(get_current_user)):
    require_roles(user, STOCK_ROLES)
    row = q("""insert into sh_estoque (produto,codigo,quantidade,tipo,descricao,situacao,responsavel_id,
               responsavel_nome,foto_url,data_ocorrencia,historico)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning *""",
            (body.produto, body.codigo, body.quantidade, body.tipo, body.descricao, body.situacao,
             user["id"], user["name"], body.foto_url, body.data_ocorrencia or date.today().isoformat(),
             Json([hist_entry(user, "Ocorrencia registrada")])), fetch="one")
    audit(user, "estoque_create", f"{body.tipo}: {body.produto}")
    return {"ocorrencia": row}

@api.patch("/estoque/{eid}")
def update_estoque(eid: str, body: EstoqueUpdate, user: dict = Depends(get_current_user)):
    require_roles(user, STOCK_ROLES)
    cur = q("select * from sh_estoque where id=%s", (eid,), fetch="one")
    if not cur:
        raise HTTPException(status_code=404, detail="Ocorrencia nao encontrada.")
    data = body.model_dump(exclude_none=True)
    hist = (cur.get("historico") or [])
    hist.append(hist_entry(user, "Ocorrencia atualizada"))
    sets, vals = [], []
    for col in ("produto", "codigo", "quantidade", "tipo", "descricao", "situacao", "foto_url"):
        if col in data:
            sets.append(f"{col}=%s"); vals.append(data[col])
    sets.append("historico=%s"); vals.append(Json(hist))
    sets.append("updated_at=now()")
    vals.append(eid)
    row = q(f"update sh_estoque set {', '.join(sets)} where id=%s returning *", tuple(vals), fetch="one")
    audit(user, "estoque_update", eid)
    return {"ocorrencia": row}

# ----------------- Dashboard -----------------
@api.get("/dashboard")
def dashboard(user: dict = Depends(get_current_user)):
    if user["role"] == "vendedor":
        davs = q("select situacao,valor from sh_davs where vendedor_id=%s", (user["id"],))
    else:
        davs = q("select situacao,valor from sh_davs")
    by = {}
    total = 0.0
    for d in davs:
        by[d["situacao"]] = by.get(d["situacao"], 0) + 1
        if d["situacao"] == "concluida":
            total += float(d.get("valor") or 0)
    stats = {
        "total_davs": len(davs), "em_andamento": by.get("em_andamento", 0),
        "reservado": by.get("reservado", 0), "concluida": by.get("concluida", 0),
        "desistiu": by.get("desistiu", 0), "vencido": by.get("vencido", 0),
        "valor_concluido": total,
    }
    if user["role"] in STOCK_ROLES:
        est = q("select situacao from sh_estoque")
        stats["ocorrencias_abertas"] = sum(1 for e in est if e["situacao"] != "resolvida")
        stats["ocorrencias_total"] = len(est)
    return {"stats": stats}

# ----------------- Notificacoes -----------------
@api.get("/notificacoes")
def list_notifs(user: dict = Depends(get_current_user)):
    rows = q("select * from sh_notificacoes where user_id=%s order by created_at desc limit 50", (user["id"],))
    return {"notificacoes": rows, "nao_lidas": sum(1 for n in rows if not n["lida"])}

@api.post("/notificacoes/{nid}/lida")
def mark_read(nid: str, user: dict = Depends(get_current_user)):
    q("update sh_notificacoes set lida=true where id=%s and user_id=%s", (nid, user["id"]), fetch=None)
    return {"ok": True}

# ----------------- AI -----------------
@api.post("/ai/chat")
async def ai_chat(body: AiIn, user: dict = Depends(get_current_user)):
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    sys = ("Voce e o assistente do sistema Shopping Hospitalar, plataforma de gestao empresarial "
           "(vendas, DAVs, estoque, funcionarios). Responda em portugues do Brasil, objetivo e profissional. "
           f"Usuario atual: {user['name']}, cargo {user['role']}.")
    chat = LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=f"sh-{user['id']}",
                   system_message=sys).with_model("openai", "gpt-5.4")
    try:
        reply = await chat.send_message(UserMessage(text=body.message))
    except Exception as e:
        logger.error(f"AI erro: {e}")
        raise HTTPException(status_code=502, detail="Nao foi possivel obter resposta da IA no momento.")
    return {"reply": reply}

# ----------------- startup -----------------
@app.on_event("startup")
def startup():
    try:
        for stmt in DDL:
            q(stmt, fetch=None)
        logger.info("Migrations aplicadas.")
    except Exception as e:
        logger.error(f"Migration falhou: {e}")
    try:
        email = os.environ["ADMIN_EMAIL"].lower()
        if not q("select id from sh_users where email=%s", (email,), fetch="one"):
            q("""insert into sh_users (email,password_hash,name,role,status,pin_hash)
                 values (%s,%s,'Administrador','admin','ativo',%s)""",
              (email, hash_secret(os.environ["ADMIN_PASSWORD"]), hash_secret(os.environ.get("ADMIN_PIN", "246810"))), fetch=None)
            logger.info("Admin criado.")
        else:
            logger.info("Admin ja existe.")
    except Exception as e:
        logger.error(f"Seed admin falhou: {e}")

app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
