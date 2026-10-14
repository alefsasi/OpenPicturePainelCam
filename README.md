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

Ou use os scripts de inicialização: `start.bat` (Windows, também por duplo clique) e `./start.sh` (Linux/macOS; se faltar permissão, `chmod +x start.sh`).

Requer Node 20.3 ou superior. Variáveis opcionais:

| Variável      | Padrão              | Descrição                                   |
| ------------- | ------------------- | ------------------------------------------- |
| `PORT`        | `7391`              | Porta HTTP (incomum, evita conflitos)       |
| `HOST`        | `127.0.0.1`         | Interface; use `0.0.0.0` para acessar da rede |
| `CONFIG_PATH` | `data/config.json`  | Arquivo de configuração                     |
| `FFMPEG_PATH` | `ffmpeg`            | Binário do FFmpeg (só o modo tempo real usa) |

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
