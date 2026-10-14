# Open Picture Painel Cam

Painel web leve para câmeras IP Hikvision no modo **Picture** (snapshots JPEG atualizados em intervalo, em vez de vídeo/RTSP). Node.js puro, **zero dependências**.

Cada câmera é lida em `http://<ip>/ISAPI/Streaming/channels/102/picture` com usuário e senha (Digest ou Basic).

## Instalação rápida (release)

Na página de [Releases](../../releases) baixe o pacote do seu sistema. Eles já trazem o Node.js embutido: **não precisa instalar nada**.

| Pacote | Para |
| ------ | ---- |
| `…-win-x64.zip` | Windows 64 bits |
| `…-linux-x64.tar.gz` | Linux 64 bits (PC, servidor) |
| `…-linux-arm64.tar.gz` | Linux ARM 64 bits (Raspberry Pi 4/5 com sistema de 64 bits) |
| `…-sem-node.zip` | Qualquer sistema que já tenha Node 20.3+ instalado (pacote minúsculo) |

**Windows:** extraia o `.zip` e dê duplo clique em `start.bat`. Abra http://127.0.0.1:7391.

**Linux:**
```bash
tar -xzf open-picture-painel-cam-*-linux-x64.tar.gz
cd open-picture-painel-cam-*-linux-x64
./start.sh
```

- **Atualizar:** extraia a versão nova em outra pasta e copie a pasta `data/` da antiga (é lá que ficam suas câmeras e senhas).
- **Tempo real:** coloque o `ffmpeg` (`ffmpeg.exe` no Windows) dentro da pasta `runtime/`. O `start` o encontra sozinho. O FFmpeg não vai embutido por causa da licença; veja [Tempo real](#tempo-real-opcional).
- **Conferir o download:** compare com o `SHA256SUMS.txt` da release (`sha256sum -c SHA256SUMS.txt`, ou `Get-FileHash` no PowerShell).

### Usar como comando de qualquer pasta (PATH do sistema)

Para iniciar o painel com um único comando, `painel-cam`, em qualquer terminal, crie um atalho numa pasta que esteja no `PATH`. O atalho só chama o `start`, então suas câmeras continuam em `data/`, dentro da pasta do programa, não importa de onde você o chame.

**Windows (PowerShell, sem precisar de administrador).** Ajuste `$app` para a pasta onde extraiu o `.zip`:

```powershell
$app = "C:\Apps\open-picture-painel-cam-v1.0.0-win-x64"
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
2. **Escutar na rede.** Crie `data/painel.env` com `HOST=0.0.0.0`, reinicie e acesse `http://IP-DO-SERVIDOR:7391` (libere a porta no firewall, se houver). O painel **não tem login**: quem alcançar a porta vê as câmeras e altera a configuração. Use só em rede confiável.

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

> A API de configuração **não tem login**. Ao usar `HOST=0.0.0.0`, exponha o painel apenas em rede confiável.

## Funcionalidades

- **Grid principal** (`/`): 1, 2×2, 3×3 ou 4×4 câmeras.
- **Câmera em foco**: em 3×3 ela ocupa 4 posições (2×2); em 4×4 ocupa 9 (3×3). Clique em ⤢ no tile para destacar. A câmera em foco fica fixa em todas as páginas e as demais se distribuem nas posições restantes.
- **Paginação** quando há mais câmeras que posições, refletida na querystring.
- **Só as câmeras visíveis são consultadas**: trocar de página ou de grid para as requisições das demais; abas em segundo plano também pausam.
- **Menu lateral (☰)**: ordem das câmeras (arrastar ou ▲▼) e atalho para as configurações.
- **Configurações** (`/config.html`): cadastrar, editar, excluir e testar câmeras; delay global entre atualizações (padrão 1000 ms) com opção de delay próprio por câmera, que sobrescreve o global; usuário/senha globais ou individuais por câmera.
- **Tempo real (opcional)**: vídeo contínuo a partir do sub-stream RTSP, por câmera ou global. Veja [Tempo real](#tempo-real-opcional). O modo snapshot continua sendo o padrão e não muda.

- **Visualização padrão**: em `/config.html` você escolhe qual grid abre por padrão (1, 2×2, 3×3, 4×4 ou 3×3/4×4 com foco). Vale quando o endereço não traz `?grid=`; links com `?grid=` continuam mandando.

### Querystring

| Parâmetro | Valores                 | Exemplo                               |
| --------- | ----------------------- | ------------------------------------- |
| `grid`    | `1`, `2`, `3`, `4`      | `/?grid=2`                            |
| `focus`   | id da câmera (só 3 e 4) | `/?grid=3&focus=a1b2c3d4`             |
| `page`    | `1`, `2`, …             | `/?grid=4&focus=a1b2c3d4&page=2`      |

## Configuração local

Salva em `data/config.json` (ignorado pelo git; veja [config.example.json](config.example.json) para o formato). Contém IPs e senhas em texto puro: **não commite**.

Credenciais: se a câmera tiver usuário próprio, usa o dela; senão usa o usuário/senha globais.

Visualização padrão: `defaultView` é `{ "grid": 1-4, "focus": true|false }` (padrão `{ "grid": 2, "focus": false }`); `focus` só vale com `grid` 3 ou 4 e destaca a primeira câmera da lista.

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

Cobrem layout/paginação, Digest (vetor da RFC 2617), configuração, o proxy contra uma câmera falsa e o streaming (hub, separador de JPEG e WebSocket) contra um FFmpeg simulado, então **não precisam do FFmpeg instalado**. Nenhum teste usa IPs ou credenciais reais. Os testes de WebSocket exigem Node 22+ (o cliente `WebSocket` global); em versões anteriores eles são pulados.
