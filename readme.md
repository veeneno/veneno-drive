# By veneno

# Drive no Discord

Este é um bot para Discord que permite fazer upload e download de arquivos, compartilhar links de chunks, e muito mais. Siga as instruções abaixo para configurar e usar o bot.

## Primeiros passos

- crie um servidor proprio para o drive
- mude sua conta para desenvolvedor

## Requisitos

- [Node.js](https://nodejs.org/) instalado (recomenda-se a versão 16 ou superior)
- Uma conta no Discord
- Criar dois ou mais bots no [Portal de Desenvolvedores do Discord](https://discord.com/developers/applications)

## Criando Bots no Discord

1. Acesse o [Portal de Desenvolvedores do Discord](https://discord.com/developers/applications).
2. Clique em "New Application" e dê um nome ao seu bot.
3. No menu à esquerda, vá para "Bot" e clique em "Add Bot".
4. Em "Token", clique em "Copy" para copiar o token do bot. **Nunca compartilhe este token!**
5. Vá para "OAuth2" no menu à esquerda e adicione as permissões necessárias, como "Administrator", para que o bot funcione corretamente.

Repita os passos acima para criar quantos bots você precisar (necessario 1 principal e 1 auxiliar) (RECOMENDADO NO MAXIMO 7 bots auxiliares + 1 principal)

## Configurando o arquivo 
`config.yaml`
### eu uso 5 bots auxiliares e 3 segundos de delay, 24mb chunk, no upload tendo 100mb, faça uma estimativa com base no seu upload na quantidade de bots, no delay, e no MAX_DL, caso utilizar pouco delay, muitos bots, MAX_DL muito alto, pode resultar na queda da internet no pc por 2 a 3 minutos.
meu 
```yaml
# Tokens dos bots
tokens:
  - "TOKEN_DO_BOT_PRINCIPAL" # Token do bot principal
  - "TOKEN_DO_BOT_AUXILIAR"   # Token do bot auxiliar 1
  - "TOKEN_DO_BOT_AUXILIAR"   # Token do bot auxiliar 2
  # Adicione mais tokens conforme necessário

# IDs do cliente e do servidor
clientId: "ID_DO_BOT"
guildId: "ID_DO_SERVIDOR"
progressChannelId: "ID_DO_CHAT_DE_COMANDOS"

# Configurações de uso de RAM e DELAY e DOWNLOAD
MAX_RAM_USAGE: 2  # 6 GB
UPLOAD_DELAY: 3 # SEGUNDOS
MAX_DL: 20

# CHUNK SIZE IMPORTANTE
# PERFORMANCE MAXIMA***
# server sem boost - 7
# server nivel 1 - 24
# server nivel 2 - 49
# server nivel 3 - 99
CHUNK_SIZE: 24 # MB 

# HEX CODES para Cores para embeds (cada embed tera uma cor aleatoria)
embedColors:
  - "#FFFFFF"
  - "#9B59B6"
  - "#3498DB"
  - "#dfe9f8"
  - "#F1C40F"
  - "#1ABC9C"
  - "#1ABC9C"
  - "#09f5a0"
```
 # Importante: O valor de CHUNK_SIZE é crucial para o desempenho do bot. Verifique a categoria do seu servidor Discord e ajuste de acordo.

 ## Executando o Bot
### Passo 1: Instalando Dependências
### Antes de iniciar o bot, você precisa instalar as dependências necessárias. No terminal, navegue até a pasta onde seu bot está localizado e execute o seguinte comando:

```bash
npm install
```
Este comando irá ler o arquivo package.json na raiz do seu projeto e instalar todas as dependências listadas.

### Passo 2: Iniciar o Bot
### Após a instalação das dependências, você pode iniciar o bot com o seguinte comando:

```bash
node bot.js
```
#### Substitua bot.js pelo nome do arquivo principal do seu bot, se necessário. Isso iniciará o bot, e ele se conectará ao Discord usando as informações e tokens configurados no arquivo config.yaml.

# Observações
- A primeira execução: Pode demorar alguns momentos na primeira execução, pois o bot estará se conectando ao Discord e inicializando.
- Se os comandos nao incializarem de primeira desligue o bot e ligue denovo
- Erros de permissão: Se você encontrar erros relacionados a permissões, verifique se o bot tem as permissões corretas configuradas no portal de desenvolvedores do Discord e se ele foi adicionado ao servidor com as permissões necessárias.
# Comandos Disponíveis
## Aqui está uma lista dos comandos disponíveis no bot e suas descrições:

- /ping: Responde com "Pong!".
- /delete: Deleta um canal e a pasta correspondente.
- /upload: Seleciona e faz o upload de um arquivo específico na pasta ./upload.
- /uploadall: Faz o upload de todos os arquivos .zip da pasta ./upload.
- /compartilhar: Cria um arquivo com os links de todos os chunks de um canal.
- /dlon: Baixa arquivos a partir de um arquivo de links na pasta shared.
- /download: Faz o download de todos os chunks de um canal.
- /info: Mostra as informações do arquivo info.txt de um canal.
- /help: Mostra uma lista de comandos e suas descrições.
# Contribuições
## Sinta-se à vontade para contribuir para este projeto. Se você encontrar algum bug ou tiver uma sugestão, abra uma issue ou um pull request.
