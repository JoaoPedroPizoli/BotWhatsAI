import OpenAI from 'openai';
import config from '../config/index.js';
import { queryDatabase } from '../database/db.js';
import { gerarHumanPrompt, gerarSQLPrompt } from '../utils/prompts.js';


const openai = new OpenAI({ apiKey: config.api.openai.apiKey });

export async function generateSQLQuery(userMessage) {
  try {
    console.log('🤖 Enviando mensagem para a IA Geradora de Query...');
    const sqlprompt = gerarSQLPrompt(userMessage);
    
    const responseSQL = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [{ role: "user", content: sqlprompt }]
    });
    
    const iaResponse = responseSQL.choices[0].message;
    console.log(`✅ Query gerada pela IA: ${iaResponse.content}`);
    
    return processUserMessage(iaResponse);
  } catch (error) {
    console.error('❌ Erro ao gerar query SQL:', error);
    throw error;
  }
}

function processUserMessage(iaResponse) {
  console.log('📝 Processando resposta da IA:', iaResponse);
  const query = iaResponse.content;
  const params = {};
  return { query, params };
}

export function executeQuery(query, params = {}) {
  try {
    console.log('🗄️ Executando a consulta local (SQLite em memória)...');
    const rows = queryDatabase(query);
    console.log('✅ Consulta executada com sucesso no DB local!');
    return rows;
  } catch (err) {
    console.error('❌ Erro ao executar a consulta local:', err);
    throw err;
  }
}

export async function respostaHumanizada(userMessage, respostaModelo, query) {
  try {
    console.log('🧠 Enviando mensagem para a IA Humanizadora de Dados...');
    console.log(query);
    
    const humanprompt = gerarHumanPrompt(userMessage, respostaModelo, query);
    
    const responseHuman = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [{ role: "user", content: humanprompt }]
    });
    
    const iaResponseHumano = responseHuman.choices[0].message.content;
    console.log(`🤖 Resposta da IA Humanizada: ${iaResponseHumano}`);
    
    return iaResponseHumano;
  } catch (error) {
    console.error('❌ Erro ao humanizar a resposta:', error);
    return '❌ Desculpe, ocorreu um erro ao processar sua mensagem.';
  }
}