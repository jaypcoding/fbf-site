# Notícias e comunicados oficiais (staging)

Branch `feature/expansao-noticias`, criada a partir de `feature/expansao-comparador`. Nada em produção.

## Site

- **`/noticias`:** lista de publicações. Os destaques vêm primeiro, depois as mais recentes. Filtros: todas, comunicados oficiais e notícias.
- **`/noticias/<endereço>`:** a publicação, com o tipo, a data, "atualizado em" quando foi editada depois de ir ao ar, a competição relacionada, o resumo e o texto.
- **Página inicial:** bloco "Notícias e comunicados" com as três mais recentes. Ele só aparece quando houver alguma publicada.
- **Menu:** novo item "Notícias".
- **Texto puro:** o texto vira parágrafos (uma linha em branco separa parágrafos). O site **nunca interpreta HTML** do texto; no teste, `<script>` apareceu como texto.

## Painel (aba "Notícias")

- Lista das publicações, editor e histórico de cada uma. Para cada alteração, o histórico mostra a ação, quando, quem (administração ou organização) e o motivo.
- O **motivo** é obrigatório em toda ação.

## Permissões (verificadas pelo banco)

| Ação | Administração | Organizador | Visitante |
| --- | --- | --- | --- |
| Ler publicadas | sim | sim | sim |
| Ler rascunhos | todos | só notícias das competições que organiza | não |
| Escrever comunicado oficial | sim | não | não |
| Escrever/editar rascunho de notícia | sim | só de competição que organiza | não |
| Publicar / despublicar | sim | não | não |
| Editar publicação no ar | sim (fica no histórico e marca "atualizado em") | não | não |
| Destacar no topo | sim | não | não |
| Excluir | só rascunho que nunca foi ao ar | idem, nas suas competições | não |

Esse é o padrão seguro: organizadores escrevem e a administração revisa e publica. Se vocês preferirem que organizadores publiquem as notícias das suas competições, a mudança é pequena e localizada.

## Migration `20261124140000_news.sql` (aditiva)

- **Tabela `news_posts`:**
  - tipo (OFFICIAL ou NEWS), título (5 a 140 caracteres), resumo (até 300), texto (até 20.000), competição opcional, destaque, situação (DRAFT ou PUBLISHED), datas de publicação e de edição após publicação, versão;
  - o **endereço** é criado a partir do título, sem acentos e sem repetição, e **nunca muda depois da primeira publicação**, para que links compartilhados continuem funcionando.
- **Tabela `news_post_changes`:** histórico **somente de acréscimo**, com a versão antes e depois, o motivo, quem fez e o papel.
- **Funções:** `save_news_post`, `publish_news_post` e `delete_news_post`.
- **Leitura:** visitantes leem só as publicações no ar. O histórico é visível só para a administração e, nas notícias das suas competições, para os organizadores.
- Uma publicação que já foi ao ar nunca é excluída: ela é despublicada.
- **Reversão:** remover as duas tabelas e as funções; nada mais depende delas.

## Testes

- **pgTAP `news`, 26 verificações:**
  - visitante e usuário comum não escrevem;
  - organizador não escreve comunicado oficial, não escreve fora das suas competições, não publica e não destaca;
  - título mínimo e motivo obrigatórios;
  - rascunho invisível para visitantes;
  - a administração publica, corrige uma publicação no ar (o endereço é mantido e a edição fica marcada) e despublica;
  - publicação que foi ao ar não é excluída; rascunho que nunca foi ao ar é excluído;
  - histórico completo, privado e somente de acréscimo.
- **Unitários (`tests/news.test.mjs`, 3 testes):** parágrafos sem interpretar HTML, resumo automático e ordem (destaque e data).
- **E2E no staging:**
  - o organizador cria um rascunho da sua competição e não vê "Publicar";
  - a administração publica, escreve um comunicado oficial destacado, publica e corrige o título da notícia no ar;
  - o histórico mostra criação pela organização, publicação e edição pela administração;
  - o visitante vê a lista e o comunicado no computador e no celular escuro;
  - o endereço antigo continua válido depois da troca de título, com "atualizado em";
  - o bloco da página inicial aparece.
- **Menu:** com os novos itens, o cabeçalho foi ajustado:
  - os rótulos não quebram de linha;
  - os ícones do menu ficam ocultos de 1201 a 1440 px;
  - de 801 a 1200 px, o menu vira o botão de menu, como no celular;
  - conferido de 390 a 1920 px, como visitante e como administrador: nenhuma sobreposição, nenhum rótulo quebrado e nenhuma rolagem lateral.
