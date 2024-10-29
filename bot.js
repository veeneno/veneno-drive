const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const axios = require('axios');
const yaml = require('js-yaml');
const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, ChannelType, StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');

const configPath = path.join(__dirname, 'config.yaml');
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

const tokens = config.tokens;
const clientId = config.clientId;
const guildId = config.guildId;
const progressChannelId = config.progressChannelId;
const CHUNK_SIZE = config.CHUNK_SIZE * 1024 * 1024; 
const UPLOAD_DELAY = config.UPLOAD_DELAY;
const MAX_RAM_USAGE = config.MAX_RAM_USAGE * 1024 * 1024 * 1024;
const MAX_DL = config.MAX_DL;
const embedColors = config.embedColors;

const createDirectoryIfNotExists = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`Diretório criado: ${dirPath}`);
    } else {
        console.log(`Diretório já existe: ${dirPath}`);
    }
};

const directories = [
    path.join(__dirname, 'download'),
    path.join(__dirname, 'downloadtemp'),
    path.join(__dirname, 'upload'),
    path.join(__dirname, 'uploadtemp'),
    path.join(__dirname, 'shared'),
    path.join(__dirname, 'ups')
];

directories.forEach(createDirectoryIfNotExists);

const clients = tokens.map(token => new Client({ intents: [GatewayIntentBits.Guilds] }));

const getRandomColor = () => embedColors[Math.floor(Math.random() * embedColors.length)];

const registerCommands = async () => {
    const rest = new REST({ version: '9' }).setToken(tokens[0]);
    try {
        console.log('Iniciando o registro de comandos...');
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [
            { name: 'ping', description: 'Responde com Pong!' },
            { name: 'delete', description: 'Deleta um canal e a pasta correspondente.', options: [{type: 7, name: 'canal', description: 'O canal a ser deletado', required: true }] },
            { name: 'upload', description: 'Seleciona e faz o upload de um arquivo específico na pasta ./upload' },
            { name: 'uploadall', description: 'Faz o upload de todos os arquivos .zip da pasta ./upload' },
            { name: 'compartilhar', description: 'Cria um arquivo com os links de todos os chunks de um canal', options: [{ name: 'channel', type: 7, description: 'O canal para compartilhar os chunks', required: true }] },
            { name: 'dlon', description: 'Baixa arquivos a partir de um arquivo de links na pasta shared' },
            { name: 'help', description: 'Exibe uma lista de comandos disponíveis.' },
            { name: 'download', description: 'Faz o download de todos os chunks de um canal', options: [{ name: 'channel', type: 7, description: 'Selecione o canal de onde deseja baixar os arquivos', required: true }] },
            { name: 'info', description: 'Mostra as informações do arquivo info.txt de um canal', options: [{ name: 'channel', type: 7, description: 'Selecione o canal para visualizar o info.txt', required: true }] }
        ]});
        console.log('Comandos registrados com sucesso!');
    } catch (error) {
        console.error('Erro ao registrar comandos:', error);
    }
};
const showInfoEmbed = async (channel, interaction) => {
    const infoFilePath = path.join('./ups', channel.name, 'info.txt');
    if (!fs.existsSync(infoFilePath)) {
        return await interaction.reply('O arquivo info.txt não foi encontrado neste canal.');
    }

    const infoContent = fs.readFileSync(infoFilePath, 'utf8');
    const lines = infoContent.split('\n');

    const fields = [];
    let zipContentField = '';
    let isZipContent = false;

    lines.forEach((line, index) => {
        const [name, value] = line.split(': ');
        
        if (name && value) {
            fields.push({ name: name.trim(), value: value.trim(), inline: false });
        } else if (line.includes('Conteúdo do Zip:')) {
            isZipContent = true;
        } else if (isZipContent) {
            if (index < 10) {
                zipContentField += `- ${line.trim()}\n`;
            } else if (index === 10) {
                zipContentField += '...mais arquivos\n';
            }
        }
    });

    if (zipContentField) {
        fields.push({ name: 'Conteúdo do Zip', value: zipContentField, inline: false });
    }

    const embed = new EmbedBuilder()
        .setTitle(`Informações do Upload - ${channel.name}`)
        .setColor(getRandomColor()) 
        .addFields(fields);

    await interaction.reply({ embeds: [embed] });
};

const getZipContents = async (filePath) => {
    const files = [];
    await fs.createReadStream(filePath)
        .pipe(unzipper.Parse())
        .on('entry', entry => {
            if (files.length < 10) files.push(entry.path);
            entry.autodrain();
        })
        .promise();
    return files;
};

const checkMemoryUsage = () => {
    const usedMemory = process.memoryUsage().heapUsed;
    return usedMemory < MAX_RAM_USAGE;
};

const generateChunks = async (filePath, outputDir, chunkSize = CHUNK_SIZE) => {
    console.log("Iniciando a geração de chunks...");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const chunkFiles = [];
    const readStream = fs.createReadStream(filePath, { highWaterMark: chunkSize });
    let chunkIndex = 0;

    for await (const chunk of readStream) {
        const chunkFileName = path.join(outputDir, `chunk_${chunkIndex}.zip`);

        if (checkMemoryUsage()) {
            fs.writeFileSync(chunkFileName, chunk);
        } else {
            const writeStream = fs.createWriteStream(chunkFileName);
            writeStream.write(chunk);
            writeStream.end();
            await new Promise(resolve => writeStream.on('finish', resolve));
        }

        chunkFiles.push(chunkFileName);
        console.log(`Chunk ${chunkIndex} gerado: ${chunkFileName}`);
        chunkIndex++;
    }

    return chunkFiles;
};

const distributeChunksToBots = async (chunkFiles, channel, message, embed) => {
    const totalChunks = chunkFiles.length;
    const chunksPerBot = Math.ceil(totalChunks / clients.length);
    let chunksSent = 0;
    const maxRetries = 3; // Define o número máximo de tentativas para cada chunk
    let retryChunks = [];  // Armazena chunks que falharam para retry

    console.log("Iniciando a distribuição de chunks entre os bots...");

    await Promise.all(clients.map(async (bot, i) => {
        const botChunks = chunkFiles.slice(i * chunksPerBot, Math.min((i + 1) * chunksPerBot, totalChunks));
        const botChannel = await bot.channels.fetch(channel.id);

        for (const chunkFile of botChunks) {
            let success = false;
            let attempts = 0;

            while (!success && attempts < maxRetries) {
                try {
                    console.log(`Bot ${i + 1} está enviando o chunk ${chunkFile} (Tentativa ${attempts + 1}) para o canal ${channel.name}`);

                    if (checkMemoryUsage()) {
                        await botChannel.send({ files: [chunkFile] });
                    } else {
                        const fileStream = fs.createReadStream(chunkFile);
                        await botChannel.send({ files: [{ attachment: fileStream, name: path.basename(chunkFile) }] });
                        fileStream.close();
                    }

                    fs.unlinkSync(chunkFile);
                    chunksSent++;
                    success = true;

                    const progressPercentage = ((chunksSent / totalChunks) * 100).toFixed(1);
                    embed.spliceFields(4, 1, { name: 'Progresso Geral', value: `${progressPercentage}% concluído` });
                    await message.edit({ embeds: [embed] });

                    await new Promise(resolve => setTimeout(resolve, UPLOAD_DELAY * 1000));
                } catch (error) {
                    attempts++;
                    console.error(`Erro ao bot ${i + 1} enviar chunk: ${chunkFile}, tentativa ${attempts}`, error);
                    if (attempts >= maxRetries) {
                        retryChunks.push(chunkFile);  // Adiciona o chunk à lista de retry se atingir o limite de tentativas
                    }
                }
            }
        }
        console.log(`Bot ${i + 1} concluiu o envio dos chunks.`);
    }));

    // Tentativa de reenvio dos chunks que falharam
    if (retryChunks.length > 0) {
        console.log("Tentando reenviar chunks que falharam...");
        for (const chunkFile of retryChunks) {
            try {
                const fileStream = fs.createReadStream(chunkFile);
                await channel.send({ files: [{ attachment: fileStream, name: path.basename(chunkFile) }] });
                fileStream.close();
                fs.unlinkSync(chunkFile);  // Deleta o arquivo se o envio for bem-sucedido
                console.log(`Chunk reenvio concluído com sucesso: ${chunkFile}`);
            } catch (error) {
                console.error(`Erro ao reenviar o chunk: ${chunkFile}`, error);
            }
        }
    }

    console.log("Todos os chunks foram processados.");
};

const uploadFile = async (fileName, interaction, progressChannelId) => {
    const filePath = path.join('./upload', fileName);
    const outputDir = path.join('./uploadtemp', fileName.replace('.zip', ''));
    const upsDir = './ups';

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    if (!fs.existsSync(upsDir)) fs.mkdirSync(upsDir);

    const fileStats = fs.statSync(filePath);
    const totalSizeGB = (fileStats.size / (1024 ** 3)).toFixed(2);
    const zipContents = await getZipContents(filePath);
    const zipContentsLimited = zipContents.join('\n') || "Nenhum arquivo no zip.";

    const uploadColor = getRandomColor();
    const sanitizedChannelName = fileName.replace(/\.zip$/, '').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 100);
    const guild = interaction.guild;
    const channel = await guild.channels.create({ name: sanitizedChannelName, type: ChannelType.GuildText });

    const embed = new EmbedBuilder()
        .setTitle('Upload em Andamento')
        .setColor(uploadColor)
        .addFields([
            { name: 'Nome do Arquivo', value: fileName || 'Indisponível', inline: true },
            { name: 'Tamanho Total', value: `${totalSizeGB} GB` || 'Indisponível', inline: true },
            { name: 'Conteúdo do Zip', value: zipContentsLimited, inline: false },
            { name: 'Status', value: 'Gerando chunks...', inline: false },
            { name: 'Progresso Geral', value: '0% concluído', inline: false }
        ]);

    const message = await clients[0].channels.cache.get(progressChannelId).send({ embeds: [embed] });

    const chunkFiles = await generateChunks(filePath, outputDir);
    embed.spliceFields(3, 1, { name: 'Status', value: 'Chunks gerados! Iniciando o envio...', inline: false });
    await message.edit({ embeds: [embed] });

    await distributeChunksToBots(chunkFiles, channel, message, embed);

    embed.setColor(uploadColor).setTitle('Upload Concluído')
        .spliceFields(3, 1, { name: 'Status', value: 'Todos os arquivos foram enviados com sucesso!', inline: false });
    await message.edit({ embeds: [embed] });

    const channelDir = path.join(upsDir, sanitizedChannelName.toLowerCase());
    if (!fs.existsSync(channelDir)) fs.mkdirSync(channelDir);
    fs.writeFileSync(
        path.join(channelDir, 'info.txt'),
        `Data de Upload: ${new Date().toISOString()}\n` +
        `Nome do Arquivo: ${fileName}\n` +
        `Tamanho Original: ${totalSizeGB} GB\n` +
        `Conteúdo do Zip:\n${zipContentsLimited}\n`
    );

    fs.rmdirSync(outputDir, { recursive: true });
    fs.unlinkSync(filePath);
};

clients[0].on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'ping') {
        await interaction.reply('Pong!');
    }
    else if (commandName === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setTitle('Comandos Disponíveis')
            .setColor('#00FF00') 
            .addFields([
                { name: '/ping', value: 'Responde com Pong!' },
                { name: '/delete', value: 'Deleta um canal e a pasta correspondente.' },
                { name: '/upload', value: 'Seleciona e faz o upload de um arquivo .zip específico na pasta ./upload.' },
                { name: '/uploadall', value: 'Faz o upload de todos os arquivos .zip da pasta ./upload.' },
                { name: '/compartilhar', value: 'Cria um txt com os links de todos os chunks de um canal. que sera salvo em ./shared' },
                { name: '/dlon', value: 'Baixa arquivos a partir de um arquivo de txt na pasta shared.' },
                { name: '/download', value: 'Faz o download de todos os chunks de um canal.' },
                { name: '/info', value: 'Mostra as informações do arquivo info.txt de um canal.' }
            ])
            .setFooter({ text: 'Todos os uploads e downloads devem ser realizados com arquivos .zip.' });
    
        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    }
    else if (commandName === 'delete') {
        const channelMention = interaction.options.getChannel('canal');
        if (!channelMention) {
            return interaction.reply('Você precisa mencionar um canal válido!');
        }
    
        try {
            await channelMention.delete();
    
            const folderPath = path.join(__dirname, 'ups', channelMention.name);
            fs.rmdirSync(folderPath, { recursive: true });
    
            await interaction.reply(`O canal ${channelMention.name} foi deletado e a pasta correspondente foi removida.`);
        } catch (error) {
            console.error(error);
            await interaction.reply('Houve um erro ao tentar deletar o canal ou a pasta.');
        }
    }
    else if (commandName === 'upload') {
        const files = fs.readdirSync('./upload').filter(file => file.endsWith('.zip'));

        if (files.length === 0) {
            return await interaction.reply('Nenhum arquivo .zip encontrado na pasta de upload.');
        }

        const options = files.map(file => ({ label: file, value: file }));
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select-upload-file')
            .setPlaceholder('Selecione um arquivo para upload')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.reply({ content: 'Escolha um arquivo para upload:', components: [row], ephemeral: true });
    }
    else if (commandName === 'uploadall') {
        const files = fs.readdirSync('./upload').filter(file => file.endsWith('.zip'));
        for (const fileName of files) {
            await uploadFile(fileName, interaction, progressChannelId);
        }
        await interaction.followUp('Upload de todos os arquivos concluído!');
    }
    else if (commandName === 'compartilhar') {
        await interaction.deferReply();
    
        const channel = interaction.options.getChannel('channel');
        if (!channel || channel.type !== ChannelType.GuildText) {
            return await interaction.editReply('Por favor, selecione um canal de texto válido.');
        }
    
        let chunkLinks = [];
        let lastMessageId;
    
        while (true) {
            const fetchedMessages = await channel.messages.fetch({ before: lastMessageId });
            if (fetchedMessages.size === 0) break;
    
            fetchedMessages.forEach(msg => {
                msg.attachments.forEach(att => {
                    if (att.name.startsWith('chunk_')) {
                        chunkLinks.push(att.url);
                    }
                });
            });
    
            if (fetchedMessages.size === 0) break; 
            lastMessageId = fetchedMessages.last().id;
        }
    
        if (chunkLinks.length === 0) {
            return await interaction.editReply('Nenhum chunk encontrado no canal para compartilhar.');
        }
    
        const removerChunksDuplicados = (chunks) => {
            const uniqueChunks = new Set();
            return chunks.filter(chunkLink => {
                const match = chunkLink.match(/chunk_\d+/);
                if (match) {
                    const chunkId = match[0]; 
    
                    if (uniqueChunks.has(chunkId)) {
                        console.log(`Chunk duplicado removido: "${chunkId}"`);
                        return false;
                    }
                    uniqueChunks.add(chunkId);
                    return true; 
                }
                return true; 
            });
        };
    
        chunkLinks = removerChunksDuplicados(chunkLinks);
    
        const shareFilePath = path.join('./shared', `${channel.name}.txt`);
        fs.writeFileSync(shareFilePath, chunkLinks.join('\n'));
    
        const originalFileName = channel.name;
        const chunkCount = chunkLinks.length;
        const totalSizeInGB = ((chunkCount - 1) * CHUNK_SIZE) / (1024 ** 3); 
    
        const embed = {
            color: 0x0099ff,
            title: `Compartilhamento de Chunks`,
            fields: [
                { name: 'Nome do Arquivo Original', value: originalFileName, inline: true },
                { name: 'Número de Chunks', value: `${chunkCount}`, inline: true },
                { name: 'Tamanho Total (aproximado) (GB)', value: `${totalSizeInGB.toFixed(2)} GB`, inline: true },
            ],
            timestamp: new Date(),
            footer: {
                text: 'Compartilhado pelo bot',
            },
        };
    
        await interaction.editReply({ embeds: [embed] });
    }    
    else if (commandName === 'download') {
        await interaction.deferReply();
    
        const channel = interaction.options.getChannel('channel');
        if (!channel || channel.type !== ChannelType.GuildText) {
            return await interaction.followUp('Por favor, selecione um canal de texto válido.');
        }
    
        const downloadTempDir = './downloadtemp';
        const finalDownloadDir = './download';
    
        if (!fs.existsSync(downloadTempDir)) fs.mkdirSync(downloadTempDir);
        if (!fs.existsSync(finalDownloadDir)) fs.mkdirSync(finalDownloadDir);
    
        let chunkFiles = [];
        let lastMessageId;
    
        while (true) {
            const fetchedMessages = await channel.messages.fetch({ before: lastMessageId });
            if (fetchedMessages.size === 0) break;
    
            fetchedMessages.forEach(msg => {
                msg.attachments.forEach(att => {
                    if (att.name.startsWith('chunk_')) {
                        chunkFiles.push({ name: att.name, url: att.url });
                    }
                });
            });
    
            lastMessageId = fetchedMessages.last().id;
        }
    
        if (chunkFiles.length === 0) {
            return await interaction.followUp('Nenhum arquivo de chunk encontrado no canal.');
        }
    
        console.log(`Total de chunks encontrados: ${chunkFiles.length}`);
    
        chunkFiles.sort((a, b) => {
            const aIndex = parseInt(a.name.split('_')[1]);
            const bIndex = parseInt(b.name.split('_')[1]);
            return aIndex - bIndex;
        });
    
        const downloadColor = getRandomColor();
        const downloadEmbed = new EmbedBuilder()
            .setTitle('Download em Andamento')
            .setColor(downloadColor)
            .addFields({ name: 'Progresso Geral', value: '0% concluído', inline: false });
    
        const progressMessage = await interaction.editReply({ embeds: [downloadEmbed] });
    
        let chunksDownloaded = 0;
        const totalChunks = chunkFiles.length;
    
        const downloadChunksForBot = async (bot, botChunks) => {
            const botName = bot.user.tag;
            console.log(`Bot ${botName} iniciou o download dos chunks.`);
    
            for (const chunk of botChunks) {
                const chunkPath = path.join(downloadTempDir, chunk.name);
                try {
                    console.log(`Bot ${botName} baixando ${chunk.name}...`);
                    const response = await axios.get(chunk.url, { responseType: 'arraybuffer' });
                    fs.writeFileSync(chunkPath, response.data);
    
                    chunksDownloaded++;
                    const progressPercentage = ((chunksDownloaded / totalChunks) * 100).toFixed(1);
                    downloadEmbed.spliceFields(0, 1, { name: 'Progresso Geral', value: `${progressPercentage}% concluído` });
                    await progressMessage.edit({ embeds: [downloadEmbed] });
    
                    console.log(`Bot ${botName} completou o download do chunk: ${chunk.name}`);
                } catch (error) {
                    console.error(`Erro ao bot ${botName} baixar o chunk ${chunk.name}:`, error);
                }
            }
    
            console.log(`Bot ${botName} concluiu o download dos seus chunks.`);
        };
    
        await Promise.all(clients.map((bot, i) => {
            const botChunks = chunkFiles.slice(i * Math.ceil(totalChunks / clients.length), Math.min((i + 1) * Math.ceil(totalChunks / clients.length), totalChunks));
            return downloadChunksForBot(bot, botChunks);
        }));
    
        console.log("Todos os chunks foram baixados. Unindo arquivos...");
        const infoFilePath = path.join('./ups', channel.name, 'info.txt');
        if (fs.existsSync(infoFilePath)) {
            const infoContent = fs.readFileSync(infoFilePath, 'utf8');
            const originalFileNameMatch = infoContent.match(/Nome do Arquivo: (.+)/);
            const originalFileName = originalFileNameMatch ? originalFileNameMatch[1] : 'arquivo.zip';
            const finalFilePath = path.join(finalDownloadDir, originalFileName);
    
            const finalWriteStream = fs.createWriteStream(finalFilePath);
    
            finalWriteStream.on('error', (error) => {
                console.error("Erro ao escrever o arquivo final:", error);
                interaction.followUp("Ocorreu um erro ao unir os arquivos.");
            });
    
            for (const chunk of chunkFiles) {
                const chunkPath = path.join(downloadTempDir, chunk.name);
                if (fs.existsSync(chunkPath)) {
                    const chunkReadStream = fs.createReadStream(chunkPath);
                    await new Promise((resolve, reject) => {
                        chunkReadStream.pipe(finalWriteStream, { end: false });
                        chunkReadStream.on('end', resolve);
                        chunkReadStream.on('error', reject);
                    });
                }
            }
    
            finalWriteStream.end();
    
            finalWriteStream.on('finish', async () => {
                const totalSize = chunkFiles.reduce((acc, chunk) => acc + fs.statSync(path.join(downloadTempDir, chunk.name)).size, 0);
                const totalSizeGB = (totalSize / (1024 ** 3)).toFixed(2);
    
                downloadEmbed.setTitle('Download Concluído')
                    .setDescription('Todos os chunks foram unidos com sucesso!')
                    .setColor(downloadColor)
                    .spliceFields(0, 1, { name: 'Progresso Geral', value: '100% concluído' })
                    .addFields(
                        { name: 'Total de Chunks', value: `${chunkFiles.length}`, inline: true },
                        { name: 'Tamanho Total', value: `${totalSizeGB} GB`, inline: true },
                        { name: 'Arquivo Final', value: originalFileName, inline: true },
                        { name: 'Localização', value: `\`${finalDownloadDir}\``, inline: false }
                    );
    
                chunkFiles.forEach(chunk => fs.unlinkSync(path.join(downloadTempDir, chunk.name)));
                await interaction.editReply({ embeds: [downloadEmbed] });
            });
        } else {
            await interaction.followUp('O arquivo info.txt não foi encontrado no diretório apropriado.');
        }
    }
    else if (commandName === 'dlon') {
        const sharedDir = './shared';
        if (!fs.existsSync(sharedDir)) {
            return await interaction.reply('A pasta "shared" não foi encontrada.');
        }
    
        const linkFiles = fs.readdirSync(sharedDir).filter(file => file.endsWith('.txt'));
    
        if (linkFiles.length === 0) {
            return await interaction.reply('Nenhum arquivo de links foi encontrado na pasta "shared".');
        }
    
        const options = linkFiles.map(file => ({ label: file, value: file }));
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select-dlon-file')
            .setPlaceholder('Selecione um arquivo para download')
            .addOptions(options);
    
        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.reply({ content: 'Escolha um arquivo para download:', components: [row], ephemeral: true });
    }
    else if (commandName === 'info') {
        const channel = interaction.options.getChannel('channel');
    
        if (!channel || channel.type !== ChannelType.GuildText) {
            return await interaction.reply('Por favor, selecione um canal de texto válido.');
        }
    
        await showInfoEmbed(channel, interaction);
    }
});

clients[0].on('interactionCreate', async (interaction) => {
    if (!interaction.isStringSelectMenu() || interaction.customId !== 'select-dlon-file') return;

    const selectedFile = interaction.values[0];
    await interaction.deferUpdate();

    const arquivoEscolhidoPath = path.join('./shared', selectedFile);
    const links = fs.readFileSync(arquivoEscolhidoPath, 'utf8').split('\n').filter(Boolean);

    if (links.length === 0) {
        return await interaction.followUp('Nenhum link foi encontrado no arquivo selecionado.');
    }

    const downloadTempDir = './downloadtemp';
    const finalDownloadDir = './download';
    if (!fs.existsSync(downloadTempDir)) fs.mkdirSync(downloadTempDir);
    if (!fs.existsSync(finalDownloadDir)) fs.mkdirSync(finalDownloadDir);

    const downloadEmbed = new EmbedBuilder()
        .setTitle('Download em Andamento')
        .setColor(getRandomColor())
        .addFields({ name: 'Progresso Geral', value: '0% concluído' });

    const progressMessage = await interaction.followUp({ embeds: [downloadEmbed] });

    console.log("Iniciando o download dos arquivos...");
    const totalLinks = links.length;
    let linksDownloaded = 0;

    const downloadLinksForBot = async (link) => {
        const linkName = path.basename(link.split('?')[0]); 
        const linkPath = path.join(downloadTempDir, linkName);
        try {
            console.log(`Baixando ${link}...`);
            const response = await axios.get(link, { responseType: 'arraybuffer' });
            fs.writeFileSync(linkPath, response.data);

            linksDownloaded++;
            const progressPercentage = ((linksDownloaded / totalLinks) * 100).toFixed(1);
            downloadEmbed.spliceFields(0, 1, { name: 'Progresso Geral', value: `${progressPercentage}% concluído` });
            await progressMessage.edit({ embeds: [downloadEmbed] });

            console.log(`Download do link ${link} concluído.`);
        } catch (error) {
            console.error(`Erro ao baixar o link ${link}:`, error);
        }
    };

    const downloadInBatches = async () => {
        for (let i = 0; i < links.length; i += MAX_DL) {
            const batch = links.slice(i, i + MAX_DL);
            await Promise.all(batch.map(downloadLinksForBot));
        }
    };

    await downloadInBatches();

    console.log("Todos os arquivos foram baixados. Iniciando junção...");
    
    const finalFilePath = path.join(finalDownloadDir, selectedFile.replace('.txt', '.zip'));
    const finalWriteStream = fs.createWriteStream(finalFilePath);

    links.sort((a, b) => {
        const aIndex = parseInt(a.split('_')[1]);
        const bIndex = parseInt(b.split('_')[1]);
        return aIndex - bIndex;
    });

    links.forEach(link => {
        const chunkName = path.basename(link.split('?')[0]);
        const chunkPath = path.join(downloadTempDir, chunkName);
        if (fs.existsSync(chunkPath)) {
            const chunkData = fs.readFileSync(chunkPath);
            finalWriteStream.write(chunkData);
        }
    });

    finalWriteStream.end();

    finalWriteStream.on('finish', async () => {
        const totalSize = links.reduce((acc, link) => acc + fs.statSync(path.join(downloadTempDir, path.basename(link.split('?')[0]))).size, 0);
        const totalSizeGB = (totalSize / (1024 ** 3)).toFixed(2);

        downloadEmbed.setTitle('Download Concluído')
            .setDescription('Todos os arquivos foram baixados e unidos com sucesso!')
            .setColor(getRandomColor())
            .spliceFields(0, 1, { name: 'Progresso Geral', value: '100% concluído' })
            .addFields(
                { name: 'Total de Chunks', value: `${links.length}`, inline: true },
                { name: 'Tamanho Total', value: `${totalSizeGB} GB`, inline: true },
                { name: 'Arquivo Final', value: selectedFile.replace('.txt', '.zip'), inline: true },
                { name: 'Localização', value: `\`${finalDownloadDir}\``, inline: false }
            );

        links.forEach(link => fs.unlinkSync(path.join(downloadTempDir, path.basename(link.split('?')[0]))));

        await interaction.followUp({ embeds: [downloadEmbed] });
    });
});


clients[0].on('interactionCreate', async (interaction) => {
    if (!interaction.isStringSelectMenu() || interaction.customId !== 'select-upload-file') return;

    const selectedFile = interaction.values[0];
    await interaction.deferUpdate(); 
    await uploadFile(selectedFile, interaction, progressChannelId);
});

clients[0].on('interactionCreate', async interaction => {
    if (!interaction.isSelectMenu()) return;

    if (interaction.customId === 'select-download-file') {
        const selectedFile = interaction.values[0]; 
        const filePath = path.join(__dirname, 'shared', selectedFile);

        await interaction.reply({
            content: `Você selecionou o arquivo: ${selectedFile}. O download está iniciando...`,
            ephemeral: true
        });

        await interaction.followUp({ files: [filePath] });
    }
});

(async () => {
    console.log("Logando todos os bots...");

    await Promise.all(clients.map((client, index) => {
        return client.login(tokens[index]).then(() => {
            console.log(`Bot ${index + 1} logado como ${client.user.tag}`);
        }).catch(err => {
            console.error(`Erro ao logar o Bot ${index + 1}:`, err);
        });
        
    }));
    await registerCommands();
})();
