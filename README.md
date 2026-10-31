# Dominó Multiplayer (web, rede local)

Jogo de dominó para 2 a 4 jogadores no navegador. O servidor roda em Node.js puro,
sem nenhuma dependência externa (nem `npm install` é necessário) e serve tanto a
interface quanto o WebSocket usado para sincronizar as jogadas.

```
node server.js          # http://localhost:3000
```

Cada jogador abre a página no navegador, um cria a sala e passa o código de 4
caracteres para os outros. Não há cadastro, banco de dados nem contas: o estado
das partidas vive na memória do processo.

---

## Regras do jogo

Variante brasileira do dominó, jogo duplo-seis (28 peças).

### Peças e jogadores

- O baralho tem 28 peças, de `0-0` até `6-6`.
- A mesa aceita de **2 a 4 jogadores**.
- Cada jogador recebe **7 peças**.
- Com 4 jogadores as 28 peças são distribuídas e o **monte fica vazio**.
  Com 2 ou 3 jogadores sobram peças no monte, que podem ser compradas.

### Quem começa

A **primeira partida** da sala começa com quem tem a **carroça de seis** (`6-6`).
As **partidas seguintes** começam com quem **venceu a partida anterior**. Se a carroça de seis estiver no monte (pode acontecer com 2 ou 3 jogadores) ou a partida
anterior terminar empatada, vale a regra antiga: começa a maior carroça; sem carroças, a peça de maior soma; persistindo o empate, o primeiro jogador da mesa.

### Como jogar

1. A primeira peça pode ser qualquer uma da mão; ela define as duas pontas da mesa.
2. Nas jogadas seguintes a peça precisa **casar com uma das pontas** (esquerda ou
   direita). A peça é encaixada com o número igual voltado para a mesa, então o
   `6` de um `4-6` pode ficar para fora.
3. Carroças (`1-1`, `4-4`, ...) são jogadas atravessadas na mesa, como de costume.
4. **É obrigatório jogar** quando existe peça que encaixa.

### Comprar e passar

- Se você não tem peça que encaixe e ainda há peças no monte, é **obrigatório
  comprar**. O monte aparece no canto inferior direito com as peças viradas para
  baixo: você clica na peça que quer puxar e ela vem para a sua mão (virada para
  cima, só você vê o número).
- Compra-se **uma peça por clique**. Se a peça comprada não servir, o monte
  continua aberto e você compra outra; se servir, o monte fecha e é obrigatório
  jogá-la.
- **Comprar tudo de uma vez:** quando **nenhuma** peça do monte encaixa nas pontas
  (por exemplo, quando as 7 peças de um número já têm dono), aparece o botão
  **"Comprar todas"** para você pegar o monte inteiro em um clique — não precisa
  comprar uma a uma só para esvaziá-lo.
- **Passe automático:** se o monte acabou e você não tem jogada, a vez **passa
  sozinha** — não há botão para clicar. Quando uma jogada obriga **todos os outros**
  a passar (um *geral*), a mesa avisa "Geral!" e a vez volta para quem jogou.
- Quem passou volta a poder jogar normalmente assim que alguém colocar uma peça
  nova na mesa.

### Fim da partida

- **Bateu (dominó):** quem ficar sem peças primeiro vence a partida na hora.
- **Jogo fechado:** se todos passarem em sequência (ninguém tem peça que encaixe e
  o monte está vazio), a partida termina e vence quem tiver a **menor soma de
  pontos na mão**. Empate na menor soma encerra a partida sem vencedor.
- **Abandono:** se um jogador sai da mesa no meio da partida, a partida é encerrada
  e a sala volta para a tela de espera, onde o anfitrião pode iniciar outra.

### Contagem de pontos

A soma da mão é a soma dos números das peças que sobraram. É usada para decidir o
vencedor no jogo fechado. A sala mantém um **placar de vitórias** acumulado
(Jogador X venceu Y vezes), exibido no painel lateral e na tela de fim de partida.

### Controles da mesa

- **🔊 Som:** liga/desliga os sinais sonoros (sua vez, jogada, compra, geral,
  vitória). A preferência fica salva no navegador.
- **☰ Painéis:** esconde/mostra os painéis laterais (placar, histórico, chat) para
  jogar usando só o canto da tela. Histórico e chat também têm botão de minimizar.
- **Mesa que cabe na tela:** a corrente de peças **dobra** como numa mesa de verdade
  (cada fileira vira para o lado contrário) e o tamanho das peças é ajustado
  automaticamente para o jogo inteiro caber **sem rolagem**, mesmo com a janela em
  tela dividida (meia tela) ou no celular.
- **🂠 Virar:** vira as peças da sua mão ao contrário (mostra o verso), para
  ninguém ao seu lado ver os números. **👁 Ocultar** recolhe a mão por completo.
- **Reordenar:** arraste as peças da mão para organizá-las na ordem que preferir.

---

## Passo a passo para hospedar em uma máquina Linux

Os comandos abaixo assumem Ubuntu/Debian. Em outras distribuições muda só o
gerenciador de pacotes.

### 1. Instalar o Node.js (versão 18 ou superior)

```bash
sudo apt update
sudo apt install -y nodejs npm
node --version    # precisa ser >= 18
```

Se a versão do repositório da distribuição for antiga, instale pelo NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Copiar o projeto para o servidor

```bash
# na sua máquina
scp -r domino_web usuario@192.168.0.10:/home/usuario/

# ou, se o projeto já está no servidor, só entre na pasta
cd ~/domino_web
```

### 3. Subir o servidor

```bash
cd ~/domino_web
node server.js
```

Saída esperada:

```
Dominó rodando em http://localhost:3000
Acesse pelo IP da máquina na rede local, ex.: http://192.168.0.10:3000
```

Não há dependências para instalar: `npm install` não é necessário. O comando
`npm start` faz a mesma coisa que `node server.js`.

### 4. Descobrir o IP da máquina na rede

```bash
hostname -I
```

Use o primeiro endereço (algo como `192.168.0.10`). Os outros jogadores abrem no
navegador:

```
http://192.168.0.10:3000
```

### 5. Liberar a porta no firewall (se estiver ativo)

```bash
sudo ufw allow 3000/tcp
sudo ufw status
```

bloquear a porta novamente

```bash
sudo ufw delete allow 3000/tcp
sudo ufw status
```

### 6. Testar

```bash
curl http://localhost:3000/health
# {"ok":true,"rooms":0,"uptime":12.3}
```

Abra a página em dois navegadores (ou um navegador e o celular na mesma rede),
crie uma sala em um deles e entre com o código no outro.

### 7. Deixar rodando como serviço (systemd)

Para o jogo continuar no ar depois que você fechar o terminal e voltar sozinho
se o processo cair:

```bash
sudo cp deploy/domino.service /etc/systemd/system/domino.service
sudo nano /etc/systemd/system/domino.service   # ajuste User= e WorkingDirectory=
sudo systemctl daemon-reload
sudo systemctl enable --now domino
sudo systemctl status domino
```

Ver logs:

```bash
journalctl -u domino -f
```

O arquivo `deploy/domino.service` já vem pronto; os três campos que você precisa
conferir são `User=` (seu usuário), `WorkingDirectory=` (caminho da pasta do
projeto no servidor) e `ExecStart=` (caminho do executável do Node). Descubra o
caminho do Node com:

```bash
which node
```

Se o Node foi instalado com `nvm`, o binário fica em algo como
`/home/usuario/.nvm/versions/node/v20.11.0/bin/node` — coloque esse caminho no
`ExecStart`, porque serviços do systemd não leem o seu `.bashrc`.

### 8. Trocar porta ou interface

```bash
PORT=8080 node server.js             # outra porta
HOST=127.0.0.1 node server.js        # só aceita conexões da própria máquina
```

No systemd, adicione `Environment=PORT=8080` na seção `[Service]`.

---

## Como usar

1. Todos abrem `http://<ip-do-servidor>:3000`.
2. Um jogador digita o nome e clica em **Criar sala**. Ele vira o anfitrião e
   recebe um código de 4 caracteres.
3. Os demais digitam o nome, clicam em **Entrar em sala**, informam o código e
   clicam em **Entrar**.
4. Quando houver pelo menos 2 jogadores, o anfitrião clica em **Iniciar partida**.
5. Na sua vez, clique na peça que quer jogar. Se ela encaixar nas duas pontas,
   escolha **Esquerda** ou **Direita** nos botões que aparecem embaixo da mesa.
6. Sem jogada possível, o **monte** abre no canto inferior direito com as peças
   viradas para baixo: clique em uma delas para comprar (uma por clique). A peça
   comprada aparece destacada na sua mão e um aviso mostra qual foi.
7. Com o monte vazio e sem jogada, o botão **Passar a vez** aparece no canto
   inferior direito.
8. Ao final, o anfitrião pode clicar em **Nova partida** para jogar de novo com a
   mesma mesa.

O painel da direita mostra o monte, o histórico de jogadas e um chat simples para
combinar as regras da casa.

---

## Estrutura do projeto

```
domino_web/
├── server.js              # HTTP estático + salas + protocolo das jogadas
├── src/
│   ├── game.js            # regras puras (baralho, encaixe, compra, fim de jogo)
│   └── ws.js              # servidor WebSocket (RFC 6455) sem dependências
├── public/
│   ├── index.html         # telas de entrada e de mesa
│   ├── style.css          # visual da mesa e das peças
│   └── app.js             # cliente: WebSocket + renderização
├── test/
│   ├── game.test.js       # testes das regras
│   └── e2e.test.js        # partida completa com 4 clientes WebSocket reais
├── deploy/domino.service  # unit do systemd para deixar rodando
└── package.json
```

O servidor é a autoridade: o navegador nunca decide se uma jogada é válida, só
envia a intenção. Toda jogada é validada em `src/game.js` e o estado enviado a
cada jogador esconde as mãos dos adversários.

## Testes

```bash
node --test                    # regras + partida ponta a ponta
node --test test/game.test.js  # só as regras
node --test test/e2e.test.js   # só a partida completa
```

Os testes de regra rodam em qualquer Node 18+. O teste ponta a ponta usa o cliente
WebSocket nativo do Node, que só existe a partir do **Node 22** — em versões mais
antigas ele aparece como `skipped`, não como falha.

O teste ponta a ponta sobe o servidor de verdade em uma porta separada, conecta
quatro clientes WebSocket, joga uma partida completa e confere que a mesa forma
uma cadeia válida, que as 28 peças estão contabilizadas e que todos os clientes
concordam com o resultado.

## Limitações conhecidas

- O estado das salas fica em memória: reiniciar o servidor apaga as salas abertas.
- Não há reconexão: se um jogador recarregar a página no meio da partida, ele
  perde a vaga (a partida em andamento é encerrada).
- Sem HTTPS/WSS: use em rede local confiável. Para expor na internet, coloque um
  proxy reverso (Nginx/Caddy) com TLS na frente.
- Máximo de 4 jogadores por mesa. O placar de vitórias é acumulado enquanto a sala
  existir; reiniciar o servidor (ou esvaziar a sala) zera o placar.
