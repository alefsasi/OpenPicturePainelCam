# Open Picture Painel Cam

Painel web leve para câmeras IP Hikvision no modo **Picture** (snapshots JPEG atualizados em intervalo, em vez de vídeo/RTSP), com **vídeo em tempo real opcional**. Node.js puro, **zero dependências**. Veja o [histórico de mudanças](CHANGELOG.md).

Cada câmera é lida em `http://<ip>/ISAPI/Streaming/channels/102/picture` com usuário e senha (Digest ou Basic).

## Instalação rápida (release)

Na página de [Releases](../../releases) baixe o pacote do seu sistema. Eles já trazem o Node.js embutido: **não precisa instalar nada**.

| Pacote | Para |
| ------ | ---- |
| `…-win-x64.zip` | Windows 64 bits |
| `…-linux-x64.tar.gz` | Linux 64 bits (PC, servidor) |
| `…-linux-arm64.tar.gz` | Linux ARM 64 bits (Raspberry Pi 4/5 com sistema de 64 bits) |
| `…-sem-node.zip` | Qualquer sistema que já tenha Node 20.3+ instalado (pacote minúsculo) |

**Windows:** extraia o `.zip` e dê duplo clique em `start.bat` (roda nesta janela) ou em `painel.bat` (menu para rodar em segundo plano, parar e iniciar com o Windows). Abra http://127.0.0.1:7391.

**Linux:**
```bash
tar -xzf open-picture-painel-cam-*-linux-x64.tar.gz
cd open-picture-painel-cam-*-linux-x64
./start.sh
```

- **Primeiro acesso:** abra *Configurações* (⚙ no menu ☰) e entre com a senha padrão **`admin`**; troque-a em seguida (veja [Senha de acesso](#senha-de-acesso)). Depois cadastre as câmeras.
- **Atualizar:** extraia a versão nova em outra pasta e copie a pasta `data/` da antiga (é lá que ficam suas câmeras e senhas). Pare o painel antigo antes (`stop`). Veja as notas de cada versão no [CHANGELOG](CHANGELOG.md).
- **Tempo real:** coloque o `ffmpeg` (`ffmpeg.exe` no Windows) dentro da pasta `runtime/`. O `start` o encontra sozinho. O FFmpeg não vai embutido por causa da licença; veja [Tempo real](#tempo-real-opcional).
- **Conferir o download:** compare com o `SHA256SUMS.txt` da release (`sha256sum -c SHA256SUMS.txt`, ou `Get-FileHash` no PowerShell).

### Usar como comando de qualquer pasta (PATH do sistema)

Para iniciar o painel com um único comando, `painel-cam`, em qualquer terminal, crie um atalho numa pasta que esteja no `PATH`. O atalho só chama o `start`, então suas câmeras continuam em `data/`, dentro da pasta do programa, não importa de onde você o chame.

**Windows (PowerShell, sem precisar de administrador).** Ajuste `$app` para a pasta onde extraiu o `.zip`:

```powershell
$app = "C:\Apps\open-picture-painel-cam-v1.1.0-win-x64"
$bin = "$env:USERPROFILE\bin"

# cria o atalho painel-cam.cmd
New-Item -ItemType Directory -Force $bin | Out-Null
Set-Content "$bin\painel-cam.cmd" "@echo off`r`ncall `"$app\start.bat`" %*" -Encoding ascii

# adiciona a pasta ao PATH do seu usuário (só se ainda não estiver lá)
$path = [Environment]::GetEnvironmentVariable("Path", "User")
if (($path -split ';') -notcontains $bin) {
  [Environment]::SetEnvironmentVariable("Path", "$path;$bin", "User")
}
```

Feche e abra o terminal e rode `painel-cam`. Para desfazer, apague `%USERPROFILE%\bin\painel-cam.cmd` (e, se quiser, a entrada `bin` em *Editar as variáveis de ambiente para sua conta*).

**Linux** (mova a pasta para um lugar fixo e crie o atalho em `/usr/local/bin`):

```bash
sudo mv open-picture-painel-cam-*-linux-x64 /opt/open-picture-painel-cam

sudo tee /usr/local/bin/painel-cam >/dev/null <<'EOF'
#!/bin/sh
exec /opt/open-picture-painel-cam/start.sh "$@"
EOF
sudo chmod +x /usr/local/bin/painel-cam
```

Depois, `painel-cam` em qualquer terminal. Use esse atalho em vez de um link simbólico (`ln -s`): o `start.sh` descobre a própria pasta pelo caminho em que foi chamado e um link o faria procurar os arquivos no lugar errado. Sem `sudo`, crie o atalho em `~/.local/bin` e adicione-o ao PATH: `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile`.

Com o atalho, todos os comandos da próxima seção ficam disponíveis como `painel-cam start`, `painel-cam stop`, `painel-cam status`...

**Porta e outras opções fixas:** em vez de variáveis de ambiente, use o arquivo `data/painel.env` (veja [Opções do servidor](#opções-do-servidor-datapainelenv)).

### Rodar em segundo plano, parar e iniciar com o sistema

Sem comando, o `start` roda preso à janela do terminal (fechou, parou). Com os comandos abaixo o painel roda **sem janela e sem prender o terminal**:

| Comando | O que faz |
| ------- | --------- |
| `start` | Roda em segundo plano |
| `stop` | Para o painel (`stop --force` encerra à força um processo que não responde) |
| `status` | Mostra se está rodando (endereço, PID) e se o início automático está ligado |
| `open` | Abre o painel no navegador |
| `logs` | Mostra o final do log |
| `menu` | Menu interativo |
| `autostart on` / `off` / `status` | Liga, desliga ou mostra o início automático |
| `reset-password` | Volta a senha das configurações para a padrão (`admin`), se você a esqueceu |

Use-os com o script do seu sistema: `.\painel.bat start` / `.\painel.bat stop` no Windows, `./start.sh start` / `./start.sh stop` no Linux (ou `painel-cam start`, se criou o atalho acima). **No Windows, dê duplo clique em `painel.bat`** para ter um menu com essas opções, sem digitar nada.

> No terminal do Windows use `painel.bat`, não `start.bat`: `start` é um comando interno do `cmd`, e digitar `start.bat` sem caminho não funciona (`.\start.bat` ou o duplo clique funcionam normalmente).

- **Sem janela:** no Windows o painel não aparece na barra de tarefas, só como `node.exe` no Gerenciador de Tarefas.
- **Parar:** `stop` pede o encerramento ao próprio painel (que só aceita esse pedido vindo do mesmo computador e com o PID certo) e fecha tudo, inclusive os FFmpeg. Se ele não responder em cerca de 5 s, encerra à força. Se o PID registrado não responder como o painel (travado ou reaproveitado por outro programa), `stop` **recusa** matar sem o `--force`, para não encerrar um programa errado. Como último recurso, finalize o `node.exe` no Gerenciador de Tarefas.
- **Arquivos:** `data/painel.pid` (PID em execução) e `data/painel.log` (mensagens e erros; passa para `painel.log.1` ao chegar a 1 MB). Se o painel não iniciar, o `start` mostra o final do log.

**Início automático (opcional, nunca obrigatório).** `autostart on` liga e `autostart off` desliga, sem precisar de administrador:

- **Windows:** cria uma entrada de inicialização do seu usuário (aparece em *Gerenciador de Tarefas → Inicializar*, onde também dá para desativá-la). O painel sobe em segundo plano quando você entra no Windows; uma janela de console pode piscar por uma fração de segundo. Se mover a pasta do programa, ligue de novo.
- **Linux:** cria o serviço systemd de usuário `painel-cam` (reinicia sozinho se cair) e tenta ativar o *linger*, que faz o serviço subir **no boot, sem ninguém logado**. Se o *linger* não puder ser ativado, o comando mostra a linha `sudo loginctl enable-linger SEU_USUARIO` para rodar uma vez. Logs: `journalctl --user -u painel-cam`; controle: `systemctl --user start|stop|status painel-cam`. O `stop` da CLI também funciona e, por ser uma saída normal, o systemd não reinicia o painel até o próximo boot.

### Linux mínimo / servidor sem tela

O painel foi pensado para rodar assim. Use o pacote `…-linux-x64.tar.gz` (ou `…-arm64.tar.gz`) e instale **dentro da sua pasta de usuário**, porque o painel grava em `data/` e o serviço é do seu usuário:

```bash
tar -xzf open-picture-painel-cam-*-linux-x64.tar.gz
mv open-picture-painel-cam-*-linux-x64 ~/painel-cam
cd ~/painel-cam
./start.sh autostart on     # sobe no boot e reinicia se cair
./start.sh start            # liga já, sem esperar o próximo boot
./start.sh status
```

**Acessar de outro computador (por exemplo, do Windows).** Por segurança o painel só escuta em `127.0.0.1`. Há duas formas:

1. **Túnel SSH (mais seguro).** No outro computador: `ssh -L 7391:127.0.0.1:7391 usuario@servidor` e abra http://127.0.0.1:7391. Nada é exposto na rede.
2. **Escutar na rede.** Crie `data/painel.env` com `HOST=0.0.0.0`, reinicie e acesse `http://IP-DO-SERVIDOR:7391` (libere a porta no firewall, se houver). Ver as câmeras **não exige login**, e as configurações pedem a [senha de acesso](#senha-de-acesso), que trafega sem criptografia (HTTP). Troque a senha padrão e use só em rede confiável.

Observações para sistemas mínimos:

- O Node embutido nos pacotes `linux-*` exige **glibc**. Em **Alpine** (musl) use o pacote `…-sem-node.zip` com o Node do próprio sistema (`apk add nodejs`). O Alpine usa OpenRC em vez de systemd, então `autostart` não se aplica: use `start`/`stop` e o init do sistema.
- Para o modo tempo real não é preciso instalar o FFmpeg pelo gerenciador de pacotes (que costuma trazer muitas dependências): coloque um binário `ffmpeg` estático em `runtime/` e dê permissão de execução.

### Opções do servidor (`data/painel.env`)

Para deixar a porta, o endereço ou o FFmpeg fixos, sem mexer nas variáveis de ambiente do sistema, crie `data/painel.env` (ele não vai para o git):

```ini
# data/painel.env
PORT=8080
HOST=0.0.0.0
FFMPEG_PATH=/caminho/para/ffmpeg
```

Funciona igual em modo normal, em segundo plano, no início automático do Windows e no serviço systemd. Variáveis de ambiente de verdade têm prioridade sobre o arquivo. `CONFIG_PATH` não vale aí, porque ele define onde esse arquivo fica.

### Gerar os pacotes

```bash
npm run package                           # pacote da sua plataforma, em dist/
npm run package -- --all                  # todos os pacotes
npm run package -- --target win-x64 --version 1.2.0
```

O script usa só módulos nativos do Node (inclusive para criar ZIP/TAR.GZ), baixa o Node de nodejs.org e confere o SHA-256 antes de embutir. Os pacotes Linux saem com permissão de execução correta mesmo se gerados no Windows.

Para publicar uma release manualmente: rode `npm test`, gere os pacotes com `npm run package -- --all`, crie a tag (`git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`) e, em [Releases → Draft a new release](../../releases/new), escolha a tag e anexe os arquivos de `dist/` (os pacotes e o `SHA256SUMS.txt`).

## Como rodar

```bash
npm start            # http://127.0.0.1:7391
```

Ou use os scripts de inicialização: `start.bat` (Windows, também por duplo clique) e `./start.sh` (Linux/macOS; se faltar permissão, `chmod +x start.sh`). Ambos aceitam comandos (`start`, `stop`, `status`…) para rodar em segundo plano.

Requer Node 20.3 ou superior. Variáveis opcionais:

| Variável      | Padrão              | Descrição                                   |
| ------------- | ------------------- | ------------------------------------------- |
| `PORT`        | `7391`              | Porta HTTP (incomum, evita conflitos)       |
| `HOST`        | `127.0.0.1`         | Interface; use `0.0.0.0` para acessar da rede |
| `CONFIG_PATH` | `data/config.json`  | Arquivo de configuração                     |
| `FFMPEG_PATH` | `runtime/ffmpeg` se existir, senão `ffmpeg` do PATH | Binário do FFmpeg (só o modo tempo real usa) |

`PORT`, `HOST` e `FFMPEG_PATH` também podem ficar em `data/painel.env` (veja [Opções do servidor](#opções-do-servidor-datapainelenv)). Para rodar sem janela e iniciar com o sistema, veja [Rodar em segundo plano](#rodar-em-segundo-plano-parar-e-iniciar-com-o-sistema).

> Ver as câmeras não exige login; as configurações e alterações pedem a [senha de acesso](#senha-de-acesso) (padrão `admin`, troque-a). Como a conexão é HTTP, ao usar `HOST=0.0.0.0` exponha o painel apenas em rede confiável ou use um túnel SSH.

## Funcionalidades

- **Visualizações** (`/`): *Iguais*, *1 destaque* ou *2 destaques*, com as câmeras sempre em 16:9, ocupando a tela sem sobras e do jeito certo para desktop, tablet e celular. Veja [Visualizações](#visualizações).
- **Só as câmeras visíveis são consultadas**: o que sai da tela (outra página, rolagem, aba oculta) deixa de ser pedido às câmeras.
- **Menu lateral (☰)**: ordem das câmeras (arrastar ou ▲▼; exige login) e atalho para as configurações.
- **Segundo plano e início automático**: roda sem janela, para com um comando e pode iniciar com o Windows ou com o Linux (opcional). Veja [Rodar em segundo plano](#rodar-em-segundo-plano-parar-e-iniciar-com-o-sistema).
- **Senha de acesso**: protege as configurações e as alterações; assistir as câmeras continua livre. Veja [Senha de acesso](#senha-de-acesso).
- **Configurações** (`/config.html`): cadastrar, editar, excluir e testar câmeras; delay global entre atualizações (padrão 1000 ms) com opção de delay próprio por câmera, que sobrescreve o global; usuário/senha globais ou individuais por câmera.
- **Tempo real (opcional)**: vídeo contínuo a partir do sub-stream RTSP, por câmera ou global. Veja [Tempo real](#tempo-real-opcional). O modo snapshot continua sendo o padrão e não muda.

## Visualizações

Na barra do topo você escolhe como ver as câmeras. Tudo fica **salvo no navegador** de cada aparelho (`localStorage`, não vai para o `config.json`) e é reaberto quando o endereço não traz parâmetros.

| Controle | Opções |
| -------- | ------ |
| **Disposição** | **Iguais** (todas do mesmo tamanho) · **1 destaque** (uma grande e as outras menores) · **2 destaques** |
| **Por página** | **Auto** (o máximo que cabe sem ficar pequeno demais) · **Todas** · 1, 2, 4, 6, 9, 12 ou 16 (os destaques contam e ficam fixos em todas as páginas) |
| **Ajuste** | **Inteira** (imagem sem cortar, em 16:9 exato) · **Preencher** (cobre 100% da área e corta um pouco das bordas) |

Clique em ⤢ numa câmera para destacá-la (⤡ para tirar do destaque). Com 2 destaques, a terceira escolhida entra no lugar da mais antiga.

**Como o espaço é aproveitado.** O painel calcula a posição de cada câmera conforme o tamanho da janela, em vez de usar uma grade fixa:

- **Desktop e tablet deitado:** tudo cabe na tela, sem rolagem. O programa escolhe o número de colunas e a divisão entre destaque e miniaturas que deixam as câmeras maiores. Com *Inteira*, a imagem nunca é cortada e a cobertura da tela costuma ficar entre 75% e 98% (medido em monitores, notebooks e tablets); com 2 ou 3 câmeras iguais numa tela bem larga sobra uma faixa maior, porque vídeo 16:9 não cobre essa área (use *Preencher* para eliminar a faixa).
- **Celular e tablet em pé:** as câmeras ocupam a largura e a página rola. O programa usa o maior número de colunas que ainda preenche a altura da tela, e as miniaturas ficam sempre menores que o destaque. Com poucas câmeras sobra espaço inevitável (um único vídeo 16:9 não preenche uma tela vertical); com *Preencher* as alturas são esticadas para cobrir mais.
- **Primeira visita:** no celular começa com *1 destaque*; nos outros aparelhos, com *Iguais*.
- **Miniaturas** (câmeras com menos de 220 px de largura): sempre em snapshot, no máximo a cada 3 s, mesmo se a câmera estiver em tempo real. Poupa dados, bateria e FFmpeg.
- **Girar o aparelho ou redimensionar a janela** reposiciona as câmeras sem recarregar nem refazer as requisições.

### Querystring

| Parâmetro | Valores | Exemplo |
| --------- | ------- | ------- |
| `layout` | `equal`, `focus1`, `focus2` | `/?layout=focus1` |
| `per` | `auto`, `all`, `1`…`64` | `/?layout=equal&per=9` |
| `focus` | ids das câmeras em destaque, separados por vírgula | `/?layout=focus2&focus=a1b2c3d4,e5f6a7b8` |
| `fit` | `contain` (padrão), `cover` | `/?layout=equal&fit=cover` |
| `page` | `1`, `2`, … | `/?layout=equal&per=4&page=2` |

Links da versão antiga (`?grid=3`, `?grid=4&focus=id`) continuam funcionando.

## Senha de acesso

- **O que protege:** a tela de configurações e **qualquer alteração**: cadastrar, editar e excluir câmeras, salvar as configurações, reordenar no menu ☰, trocar a senha e o botão *Testar*. **Assistir as câmeras continua livre.** Quem não entrou só recebe o nome e o modo das câmeras: IP, usuário e porta ficam escondidos.
- **Senha padrão: `admin`.** Enquanto ela estiver em uso, a tela de configurações mostra um aviso. Troque-a em *Configurações → Senha de acesso* (mínimo 6 caracteres; não pode ser `admin`).
- **Como é guardada:** só o hash (scrypt) em `config.json`, nunca a senha em texto puro. O login vira um cookie `HttpOnly` e `SameSite=Strict` válido por 12 h; as sessões ficam em memória, então reiniciar o painel pede novo login, e trocar a senha derruba os outros dispositivos. Cinco senhas erradas seguidas bloqueiam aquele endereço por 1 minuto.
- **Esqueceu a senha?** No computador do painel: `painel.bat reset-password` (Windows) ou `./start.sh reset-password` (Linux). Funciona com o painel rodando ou parado e volta para `admin`.
- **Atenção:** a conexão é HTTP, então na rede a senha trafega **sem criptografia**. Troque a senha padrão e use só em rede confiável, ou acesse por túnel SSH (veja [Linux mínimo](#linux-mínimo--servidor-sem-tela)).

## Configuração local

Salva em `data/config.json` (ignorado pelo git; veja [config.example.json](config.example.json) para o formato). Contém IPs e senhas em texto puro: **não commite**.

Credenciais: se a câmera tiver usuário próprio, usa o dela; senão usa o usuário/senha globais.

Delay: se a câmera tiver `refreshDelayMs`, ele sobrescreve o global; vazio/`null` usa o global (vale só para snapshots).

Modo de atualização: `streamMode` é `"snapshot"` (padrão) ou `"realtime"`. Se a câmera tiver `streamMode`, ele sobrescreve o global; `null` usa o global. `rtspPort` (opcional, padrão 554) é a porta RTSP da câmera, separada da porta HTTP do `ip`. O global também guarda `realtime: { fps, maxWidth }` (padrão 10 fps, 640 px).

## Como funciona

O navegador nunca fala direto com as câmeras. O servidor busca o snapshot (`GET /api/cameras/:id/snapshot`), autentica via Digest reaproveitando o nonce (1 round-trip por quadro) e repassa a imagem. Assim as senhas não chegam ao navegador, não há problema de CORS/Digest e uma câmera lenta não empilha requisições: cada tile só pede o próximo quadro depois de concluir o anterior.

### Proteção contra bloqueio da câmera

Câmeras Hikvision **bloqueiam o login por cerca de 30 minutos** depois de poucas tentativas com senha errada ("O dispositivo está bloqueado. Volte a tentar após N minuto(s)"). Por isso, quando uma câmera recusa o usuário/senha, o painel faz **uma única tentativa** e pausa por 10 minutos as requisições com aquelas credenciais (snapshot e tempo real), em vez de insistir a cada atualização. A pausa termina antes se você corrigir a senha, salvar a configuração ou usar o botão **Testar** (que sempre tenta uma vez). A mensagem "Tentativas pausadas…" aparece no tile.

## Tempo real (opcional)

Alternativa aos snapshots: vídeo contínuo e fluido, ativado **por câmera** (campo "Modo de atualização") ou **globalmente** (modo padrão). Nada muda para quem continua em snapshot; cada tile da mesma grid pode usar um modo diferente.

**Requisito:** o [FFmpeg](https://ffmpeg.org/download.html) instalado no servidor (binário externo, não é dependência do npm). Ex.: `sudo apt install ffmpeg`, `winget install Gyan.FFmpeg`, ou aponte `FFMPEG_PATH` para o executável. Sem ele o painel avisa na tela de configurações e **cai em snapshot automaticamente**.

```
Câmera --RTSP (sub-stream 102)--> FFmpeg --JPEGs--> Node --WebSocket--> <img> do tile
```

- **Sub-stream:** usa `rtsp://<ip>:554/Streaming/Channels/102` (o mesmo canal 102 do snapshot), em TCP. O vídeo é reduzido para no máximo `maxWidth` px e `fps` quadros/s, o que mantém a CPU baixa. Não há re-encode de áudio (descartado).
- **Um FFmpeg por câmera, só enquanto alguém assiste:** vários navegadores compartilham o mesmo processo, que encerra ~5 s depois que o último espectador sai. Se a câmera cair ou travar (10 s sem quadros), reinicia sozinho com backoff. Limite de 16 streams simultâneos.
- **Um único WebSocket por navegador** (`/api/stream`) leva todas as câmeras visíveis. Isso evita o limite de ~6 conexões HTTP por origem que uma grid 4×4 estouraria com streams MJPEG em `<img>`. Quadros de um cliente lento são descartados em vez de acumularem atraso.
- **Latência:** o pipeline não acumula buffers (`nobuffer`, `low_delay`, sem espera no Node). O que sobra depende da câmera: configure o sub-stream com intervalo de I-frame curto (1 s ou menos) e, se possível, sem B-frames, para ficar abaixo de 1 s. A primeira imagem demora um pouco mais, pois o FFmpeg precisa conectar e esperar um quadro-chave.
- **Segurança:** o WebSocket recusa `Origin` diferente do `Host` (outro site aberto no navegador não consegue assistir por este servidor), e o servidor continua escutando só em `127.0.0.1` por padrão.

> **Atenção:** a senha da câmera vai na URL RTSP passada ao FFmpeg, então fica visível na lista de processos (`ps`) do servidor para outros usuários da mesma máquina. Mensagens de erro nunca incluem a URL. Em servidor compartilhado, use uma conta de câmera só de visualização.

Protocolo do WebSocket (para quem quiser integrar outro cliente): o cliente envia `{"watch": ["id", ...]}` com a lista completa do que está visível; o servidor responde texto `{"id","state":"live"|"error","message"}` e binário `[1 byte: tamanho do id][id][JPEG]`.

## Testes

```bash
npm test
```

Cobrem: cálculo de layout (cada câmera aparece uma vez, nada sai da tela nem se sobrepõe, tiles 16:9 exatos, cobertura mínima em vários tamanhos de tela), querystring e preferências, Digest (vetor da RFC 2617), configuração, senha de acesso (hash, sessões, limite de tentativas, rotas protegidas), o proxy contra uma câmera falsa, o streaming (hub, separador de JPEG e WebSocket) contra um FFmpeg simulado, a CLI (iniciar, parar, status, redefinir senha) e o empacotamento (ZIP/TAR.GZ). **Não precisam do FFmpeg instalado.** Nenhum teste usa IPs ou credenciais reais. Os testes de WebSocket exigem Node 22+ (o cliente `WebSocket` global); em versões anteriores eles são pulados.
