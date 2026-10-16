# Histórico de mudanças

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versões no padrão [SemVer](https://semver.org/lang/pt-BR/).

## [1.1.0] - 2026-10-15

Senha de acesso às configurações, layouts novos que aproveitam a tela inteira (desktop, tablet e celular) e execução em segundo plano.

### Atenção ao atualizar

- **Agora as configurações pedem senha.** A senha inicial é **`admin`**: entre em *Configurações* e troque-a em *Senha de acesso*. Enquanto ela estiver em uso, a tela mostra um aviso.
- **Alterações pela API exigem login** (cadastrar/editar/excluir câmera, salvar configurações, reordenar, trocar a senha). Quem só assiste as câmeras não precisa de senha. Scripts que alteravam a configuração sem login deixam de funcionar.
- **Sem login, a lista de câmeras não mostra mais IP, usuário nem porta**, só nome e modo de atualização.
- **A visualização padrão saiu das configurações globais.** Agora cada navegador lembra a última visualização usada. A chave `defaultView` de uma `config.json` antiga é ignorada e removida na próxima gravação.
- **Links antigos** (`?grid=3`, `?grid=4&focus=id`) continuam funcionando e são convertidos para os layouts novos.
- Feche o painel antigo antes de atualizar (`stop`, ou finalize o `node.exe`); instâncias iniciadas por versões anteriores não têm PID registrado.

### Adicionado

- **Senha de acesso** (padrão `admin`) para a tela de configurações e para qualquer alteração. Guardada como hash scrypt; sessão por cookie `HttpOnly`/`SameSite=Strict` de 12 h; bloqueio de 1 minuto após 5 senhas erradas seguidas; troca de senha derruba os outros dispositivos.
- **`reset-password`** na CLI: volta a senha para a padrão, com o painel rodando ou parado.
- **Layouts**: *Iguais*, *1 destaque* e *2 destaques*; **Por página** (Auto, Todas, 1–16); **Ajuste** *Inteira* (16:9 sem cortar) ou *Preencher* (cobre 100% da área). Escolhas salvas no navegador de cada aparelho. Novos parâmetros de URL: `layout`, `per`, `focus` (vários ids), `fit`, `page`.
- **Motor de layout** (`public/packing.js`) que posiciona cada câmera em 16:9 conforme o tamanho da janela, em vez de uma grade fixa, com variações para tela deitada (tudo cabe) e tela em pé (colunas com rolagem). Reposiciona ao girar o aparelho ou redimensionar a janela, sem recarregar.
- **Celular e tablet em pé**: colunas na largura da tela com rolagem; na primeira visita o celular abre em *1 destaque*; botão de destacar sempre visível em telas de toque.
- **Miniaturas** (câmeras com menos de 220 px de largura) atualizam por snapshot a cada 3 s no máximo, mesmo em tempo real.
- **Segundo plano**: comandos `start`, `stop`, `status`, `open`, `logs`, `menu` e `autostart on|off|status` (`painel.bat` no Windows; `./start.sh` no Linux). Log em `data/painel.log` e PID em `data/painel.pid`. Parada graciosa pelo próprio painel (só aceita pedido do mesmo computador e com o PID certo), com encerramento forçado apenas com `stop --force`.
- **Início automático opcional**: Windows pela entrada de inicialização do usuário; Linux por serviço systemd de usuário com *linger*, pensado para servidores sem tela.
- **`data/painel.env`** (opcional) para fixar `PORT`, `HOST` e `FFMPEG_PATH` sem usar variáveis de ambiente do sistema.
- **`painel.bat`**: menu por duplo clique no Windows (o nome `start.bat` colide com o comando interno `start` do cmd no terminal).
- Pacotes de release incluem este histórico.

### Alterado

- Em tela em pé o painel escolhe o maior número de colunas que ainda preenche a altura, e as miniaturas ficam sempre menores que o destaque.
- Reordenar câmeras no menu ☰ exige login; sem login o menu mostra um link para entrar.
- O botão **Testar** (`force`) só ignora a pausa anti-bloqueio para quem está logado.
- `HOST=0.0.0.0` agora é viável com mais segurança, mas a conexão continua sendo HTTP: troque a senha padrão e use só em rede confiável ou por túnel SSH.
- Quando a porta já está em uso, o painel avisa com uma mensagem clara.

### Removido

- Seleção de grid fixa (1, 2×2, 3×3, 4×4) e a "visualização padrão" das configurações globais, substituídas pelos layouts novos e pela preferência por navegador.

### Corrigido

- O timeout de 5 s da detecção do FFmpeg podia marcar o tempo real como indisponível mesmo após a detecção bem-sucedida.
- Resposta do `/api/ping` sem o identificador do painel (a CLI achava que ele não respondia).

## [1.0.0] - 2026-10-14

Primeira versão.

### Adicionado

- Painel de câmeras Hikvision no modo **Picture** (snapshots JPEG), em Node.js puro e sem dependências, com configuração local em JSON.
- Grid de 1, 2×2, 3×3 e 4×4 câmeras, câmera em foco, paginação pela querystring e menu lateral para ordenar as câmeras.
- Proxy de snapshots com autenticação Digest/Basic (reaproveita o nonce) e senhas que nunca chegam ao navegador.
- Só as câmeras visíveis são consultadas; abas em segundo plano pausam.
- Configurações: cadastrar, editar, excluir e testar câmeras; delay global e por câmera; usuário e senha globais ou por câmera.
- **Tempo real opcional** (por câmera ou global) a partir do sub-stream RTSP via FFmpeg, com WebSocket único por navegador, e queda automática para snapshot quando o FFmpeg não existe.
- **Proteção contra bloqueio das câmeras**: depois de uma recusa de usuário/senha, pausa de 10 minutos nas tentativas com as mesmas credenciais.
- Pacotes de release com Node embutido (Windows x64, Linux x64 e ARM64) e pacote sem Node; scripts `start.bat` e `start.sh`; porta padrão 7391.

[1.1.0]: ../../releases/tag/v1.1.0
[1.0.0]: ../../releases/tag/v1.0.0
