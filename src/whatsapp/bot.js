import { Client as WhatsAppClient, LocalAuth as WhatsAppLocalAuth, MessageMedia } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs-extra';
import path from 'path';
import NodeCache from 'node-cache';
import pLimit from 'p-limit';
import config from '../config/index.js';
import { processAudioFile } from '../services/audioService.js';
import { generateSQLQuery, executeQuery, respostaHumanizada } from '../services/aiService.js';
import { gerarGrafico } from '../services/graphicService.js';

const cache = new NodeCache(config.services.cacheOptions);
const limit = pLimit(config.services.rateLimit);
const mensagensRespondidas = new Map();
const userRequests = new Map();

export class WhatsAppBot {
  constructor() {
    this.client = new WhatsAppClient({
      authStrategy: new WhatsAppLocalAuth(),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox'
        ]
      },
    });

    this.client.on('qr', this.onQrCode.bind(this));
    this.client.on('ready', this.onReady.bind(this));
    this.client.on('message', this.onMessage.bind(this));
    
    setInterval(this.limparMensagensRespondidas.bind(this), config.whatsapp.armazenamentoMensagens / 2);
  }

  initialize() {
    this.client.initialize();
    console.log('🤖 Inicializando bot do WhatsApp...');
  }

  onQrCode(qrCode) {
    qrcode.generate(qrCode, { small: true });
    console.log('🔗 Escaneie o QR Code acima com o WhatsApp.');
  }

  onReady() {
    console.log('✅ Bot WhatsApp pronto!');
  }

  async onMessage(msg) {
    const userNumber = msg.from;
    let messageText = msg.body ? msg.body.trim().toLowerCase() : '';

    // Define se deve gerar gráfico caso a mensagem contenha "&"
    let querGerar = false;
    if (messageText.includes('&')) {
      querGerar = true;
    }

    if (msg) {
      await this.client.sendMessage(
        msg.from,
        '⏳*Gerando a consulta com AI...*\n\n' +
        'Perido de Dados: Últimos *5 anos*\n' +
        '- Mande sua Requisição por *Áudio* ou *Texto*!\n'
      );
    }

    const requestId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    try {
      // Verificar se é um comando de cancelamento
      if (messageText === 'cancelar') {
        return this.handleCancelRequest(userNumber);
      }

      // Configurar requisição atual
      const userReqs = userRequests.get(userNumber) || [];
      const currentRequest = {
        requestId,
        cancelRequested: false,
        queryInProgress: true
      };
      userReqs.push(currentRequest);
      userRequests.set(userNumber, userReqs);

      // Evitar duplicação de respostas para a mesma mensagem
      const msgId = msg.id._serialized;
      if (mensagensRespondidas.has(msgId)) {
        return;
      }
      mensagensRespondidas.set(msgId, Date.now());

      console.log(`📩 Mensagem recebida de ${msg.from}: ${msg.body}`);
      let userMessage = '';

      // Função para verificar cancelamento de requisição
      const checkCancel = () => {
        const updatedUserReqs = userRequests.get(userNumber) || [];
        const thisReq = updatedUserReqs.find(r => r.requestId === requestId);
        return !thisReq || thisReq.cancelRequested;
      };

      // Função para finalizar requisição
      const finalizeRequest = () => {
        const updatedUserReqs = userRequests.get(userNumber) || [];
        const newReqs = updatedUserReqs.filter(r => r.requestId !== requestId);
        userRequests.set(userNumber, newReqs);
      };

      // Processar mensagem de áudio ou texto
      if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt')) {
        userMessage = await this.handleAudioMessage(msg, checkCancel);
        if (checkCancel()) {
          finalizeRequest();
          return;
        }
      } else {
        userMessage = msg.body;
      }

      if (checkCancel()) {
        console.log('🚫 A requisição foi cancelada antes de gerar a query.');
        finalizeRequest();
        return;
      }

      // Gerar e executar a consulta SQL usando a IA
      const { query, params } = await generateSQLQuery(userMessage);

      if (checkCancel()) {
        console.log('🚫 A requisição foi cancelada antes de executar a consulta.');
        finalizeRequest();
        return;
      }

      if (query) {
        try {
          // Executar a consulta no banco de dados
          const rows = executeQuery(query, params);

          if (checkCancel()) {
            console.log('🚫 A requisição foi cancelada antes de enviar a resposta.');
            finalizeRequest();
            return;
          }

          // Processar os resultados da consulta
          let respostaModelo = '';
          const MAX_ROWS = 790;
          if (rows && rows.length > 0) {
            const displayedRows = rows.slice(0, MAX_ROWS);
            displayedRows.forEach((row) => {
              respostaModelo += JSON.stringify(row) + "\n";
            });
          } else {
            respostaModelo = '❌ Nenhum resultado encontrado para sua consulta.';
          }

          console.log('📊 Dados Brutos da Consulta:', respostaModelo);
          
          // Humanizar a resposta
          const respostaHuman = await respostaHumanizada(userMessage, respostaModelo, query);

          if (checkCancel()) {
            console.log('🚫 A requisição foi cancelada antes de enviar resposta humanizada.');
            finalizeRequest();
            return;
          }
          
          // Enviar resposta ao usuário
          await this.client.sendMessage(msg.from, respostaHuman);

          // Gerar Gráfico se necessário
          if (querGerar === true) {
            await gerarGrafico(userMessage, respostaModelo);
            const media = MessageMedia.fromFilePath('/grafico.png');
            await this.client.sendMessage(msg.from, media);
          }

          console.log(`✅ Resposta enviada para ${msg.from}`);
        } catch (dbError) {
          console.error('❌ Erro ao executar a consulta no banco de dados local:', dbError);
          if (!checkCancel()) {
            await this.client.sendMessage(msg.from, '❌ Desculpe, ocorreu um erro ao consultar o banco de dados local.');
          }
        }
      } else {
        if (!checkCancel()) {
          await this.client.sendMessage(msg.from, '❌ Desculpe, não entendi sua solicitação.');
        }
      }

      finalizeRequest();

    } catch (error) {
      console.error('❌ Erro ao processar a mensagem:', error);
      const userReqs = userRequests.get(userNumber) || [];
      const thisReq = userReqs.find(r => r.requestId === requestId);
      if (thisReq && !thisReq.cancelRequested) {
        await this.client.sendMessage(msg.from, '❌ Desculpe, ocorreu um erro ao processar sua mensagem.');
      }
      const newReqs = (userRequests.get(userNumber) || []).filter(r => r.requestId !== requestId);
      userRequests.set(userNumber, newReqs);
    }
  }

  async handleAudioMessage(msg, checkCancel) {
    const media = await msg.downloadMedia();
    const audioBuffer = Buffer.from(media.data, 'base64');
    const audioFileName = path.resolve(config.paths.audios, `${msg.id.id}.ogg`);
    await fs.writeFile(audioFileName, audioBuffer);
    console.log(`📁 Áudio salvo em ${audioFileName}`);

    if (checkCancel()) {
      console.log('🚫 A transcrição foi cancelada antes da conversão.');
      return '';
    }

    try {
      const userMessage = await processAudioFile(audioFileName);
      console.log(`📝 Transcrição da mensagem de áudio: ${userMessage}`);
      return userMessage;
    } catch (error) {
      console.error('❌ Erro ao processar áudio:', error);
      throw error;
    }
  }

  async handleCancelRequest(userNumber) {
    const userReqs = userRequests.get(userNumber) || [];
    if (userReqs.length > 0) {
      const lastRequest = userReqs[userReqs.length - 1];
      lastRequest.cancelRequested = true;
      console.log(`🚫 Cancelando a requisição ${lastRequest.requestId} do usuário ${userNumber}.`);
      await this.client.sendMessage(userNumber, '🚫 Sua última requisição foi cancelada.');
    } else {
      await this.client.sendMessage(userNumber, '❌ Não há requisição em andamento para cancelar.');
    }
    return;
  }

  limparMensagensRespondidas() {
    const agora = Date.now();
    for (const [msgId, timestamp] of mensagensRespondidas) {
      if (agora - timestamp > config.whatsapp.armazenamentoMensagens) {
        mensagensRespondidas.delete(msgId);
      }
    }
  }
}
