# Configuração de chamadas LiveKit — Tiooficial

As chamadas de áudio e vídeo usam LiveKit Rooms. O token de acesso é emitido pelo backend autenticado; a chave secreta não deve ser colocada no frontend nem commitada no GitHub.

## Variáveis de ambiente do backend

Configure no ambiente do backend (Emergent ou serviço que executa a API):

- `LIVEKIT_URL`: URL WebSocket do projeto LiveKit, normalmente começando por `wss://`.
- `LIVEKIT_API_KEY`: API Key criada no projeto LiveKit.
- `LIVEKIT_API_SECRET`: API Secret correspondente. Guarde como segredo do servidor.

Use um projeto LiveKit próprio para o Tiooficial. Não reutilize credenciais de outro aplicativo sem confirmar que essa é a intenção.

## Configuração e validação

1. Instale as dependências do projeto e publique o backend com as três variáveis.
2. Aplique `supabase_migration_communication.sql` no projeto Supabase correto para criar as tabelas de conversas, mensagens e convites. A migração é aditiva e não apaga tabelas/dados existentes.
3. Publique o frontend com a dependência `livekit-client`.
4. Teste áudio e vídeo entre dois usuários autenticados, em dispositivos/redes diferentes.
5. Confirme permissões de microfone/câmera e a URL `wss://` do LiveKit.

O endpoint `POST /api/chamadas/livekit-token` verifica que o usuário pertence à conversa e gera um token de sala com validade de uma hora. Não envie `LIVEKIT_API_SECRET` ao navegador nem em mensagens.
