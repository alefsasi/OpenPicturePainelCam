# Open Picture Painel Cam

Painel web leve para câmeras IP Hikvision no modo **Picture** (snapshots JPEG atualizados em intervalo, em vez de vídeo/RTSP). Node.js puro, **zero dependências**.

Cada câmera é lida em `http://<ip>/ISAPI/Streaming/channels/102/picture` com usuário e senha (Digest ou Basic).

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

> A API de configuração **não tem login**. Ao usar `HOST=0.0.0.0`, exponha o painel apenas em rede confiável.

## Funcionalidades

- **Grid principal** (`/`): 1, 2×2, 3×3 ou 4×4 câmeras.
- **Câmera em foco**: em 3×3 ela ocupa 4 posições (2×2); em 4×4 ocupa 9 (3×3). Clique em ⤢ no tile para destacar. A câmera em foco fica fixa em todas as páginas e as demais se distribuem nas posições restantes.
- **Paginação** quando há mais câmeras que posições, refletida na querystring.
- **Só as câmeras visíveis são consultadas**: trocar de página ou de grid para as requisições das demais; abas em segundo plano também pausam.
- **Menu lateral (☰)**: ordem das câmeras (arrastar ou ▲▼) e atalho para as configurações.
- **Configurações** (`/config.html`): cadastrar, editar, excluir e testar câmeras; delay global entre atualizações (padrão 1000 ms) com opção de delay próprio por câmera, que sobrescreve o global; usuário/senha globais ou individuais por câmera.

### Querystring

| Parâmetro | Valores                 | Exemplo                               |
| --------- | ----------------------- | ------------------------------------- |
| `grid`    | `1`, `2`, `3`, `4`      | `/?grid=2`                            |
| `focus`   | id da câmera (só 3 e 4) | `/?grid=3&focus=a1b2c3d4`             |
| `page`    | `1`, `2`, …             | `/?grid=4&focus=a1b2c3d4&page=2`      |

## Configuração local

Salva em `data/config.json` (ignorado pelo git; veja [config.example.json](config.example.json) para o formato). Contém IPs e senhas em texto puro: **não commite**.

Credenciais: se a câmera tiver usuário próprio, usa o dela; senão usa o usuário/senha globais.

Delay: se a câmera tiver `refreshDelayMs`, ele sobrescreve o global; vazio/`null` usa o global.

## Como funciona

O navegador nunca fala direto com as câmeras. O servidor busca o snapshot (`GET /api/cameras/:id/snapshot`), autentica via Digest reaproveitando o nonce (1 round-trip por quadro) e repassa a imagem. Assim as senhas não chegam ao navegador, não há problema de CORS/Digest e uma câmera lenta não empilha requisições: cada tile só pede o próximo quadro depois de concluir o anterior.

## Testes

```bash
npm test
```

Cobrem layout/paginação, Digest (vetor da RFC 2617), configuração e o proxy contra uma câmera falsa. Nenhum teste usa IPs ou credenciais reais.
