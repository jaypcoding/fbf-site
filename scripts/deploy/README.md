# Deploy do frontend na VPS

O site é estático (Vite). O Nginx da VPS serve `fbfhax.com` a partir de
`/usr/share/nginx/fbf` (`/etc/nginx/conf.d/fbf.conf`, SPA com
`try_files … /index.html`, TLS pelo Certbot). O mesmo servidor também serve
outro site, com raiz em `/usr/share/nginx/html`: não altere essa pasta nem a
configuração dele.

## Publicar

Pré-requisitos na máquina que publica:

- árvore Git limpa, no commit que será publicado (o CI dele precisa estar verde);
- `.env.local` com as variáveis do projeto Supabase de produção;
- chave SSH da VPS com permissão restrita ao usuário.

```bash
export FBF_VPS_HOST="ec2-user@<ip-da-vps>"
export FBF_VPS_KEY="<caminho-da-chave>"
export FBF_EXPECTED_SUPABASE_HOST="<project-ref>.supabase.co"
bash scripts/deploy/deploy-vps.sh
```

O script:

1. gera o build a partir do commit atual (o build **nunca** roda na VPS: menos de
   1 GB de RAM e outro site no mesmo servidor);
2. recusa publicar se o bundle não apontar para o host Supabase esperado;
3. envia o `dist/` como release versionada para `~/releases/<data>-<commit>`;
4. copia a pasta publicada para `/usr/share/nginx/fbf-backup-<release>` e grava o
   caminho em `~/releases/LAST_BACKUP`;
5. sincroniza a release com `rsync --delete`, ajusta o dono para `nginx` e grava
   `~/releases/CURRENT`;
6. confere, pelo Nginx da própria VPS, se o novo bundle está sendo servido; se não
   estiver, restaura o backup automaticamente.

Não é preciso recarregar o Nginx para arquivos estáticos.

## Reverter

```bash
bash scripts/deploy/rollback-vps.sh                 # último backup
bash scripts/deploy/rollback-vps.sh /usr/share/nginx/fbf-backup-<release>
```

## Observações

- O clone `~/fbf-deploy` na VPS é de um fluxo antigo (build no servidor). Ele está
  desatualizado e tem alterações locais; não é usado por estes scripts.
- A CLI do Supabase dentro desse clone está vinculada à produção: não execute
  comandos de banco a partir da VPS.
- Migrations de banco não fazem parte deste deploy: o frontend publicado precisa
  ser compatível com o schema que já está em produção.
