import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";
import puppeteer from 'puppeteer';
import config from '../config/index.js';


const genAI = new GoogleGenerativeAI(config.api.google.apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-pro-exp-02-05" });

export async function gerarGrafico(userRequest, dados) {
  try {
    const htmlPath = path.join(config.paths.graficos, 'index.html');
    const prompt = generateGraphPrompt(userRequest, dados);
    
    // Gera o HTML com o gráfico usando o modelo Gemini
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0 }
    });
    
    let htmlCode = await result.response.text();
    htmlCode = htmlCode.replace(/^```html\s*/, '').replace(/\s*```$/, '');
    
    // Salva o HTML gerado
    fs.writeFileSync(htmlPath, htmlCode);
    console.log('✅ HTML do gráfico gerado com sucesso!');
    
    // Gera a imagem PNG do gráfico
    await gerarImagemDoGrafico(htmlPath);
    console.log('✅ PNG do gráfico gerado com sucesso!');
    
    return path.join(config.paths.graficos, 'grafico.png');
  } catch (error) {
    console.error('❌ Erro ao gerar gráfico:', error);
    throw error;
  }
}

 function generateGraphPrompt(userRequest, dados) {
  return `
Analise os dados dinâmicos que serão fornecidos e determine o melhor tipo de gráfico para uma visualização e análise ideais.
Analise a Requisição do Usuário para ajudar a determinar o TITULO do Gráfico e a melhor maneira de organiza-lo  
Atenção:
- O gráfico deve ser claro e NÃO interativo.
- O tamanho do gráfico deve ser adequado para conversão em PNG.
- A proporção do gráfico deve se ajustar a uma tela web desktop padrão.
- Utilize um container com 80% de largura e máximo de 1000px.
- Utilize ponto para separar as casas decimais.
- O canvas deve ocupar 100% da largura do container e ter height: auto para manter a proporção.
- Se a proporção entre os dados das colunas tiver uma diferença de 2 casas decimais ou mais (ex: 600.000.000 / 6.000.000), altere o gráfico e aumente em 45% o tamanho das colunas menores.
- Os números/dados devem aparecer permanentemente no gráfico, sem necessidade de clique ou hover para visualizá-los.


#Requisição do Usuário:
${userRequest}

#Dados:
${dados} 

Utilizando as seguintes tecnologias, crie tudo em um único arquivo "index.html":
- HTML: para estruturar a página.
- CSS: para estilizar a página e o gráfico, conferindo uma aparência moderna e responsiva.
- JavaScript: para a lógica do gráfico e manipulação dos dados.
- Chart.js: para criar o gráfico de barras.

-Não cometa erros na configuração do ChartDataLabels.
-Não coloque os 3 backticks e no início escrito HTML e 3 backticks no final
-Responda APENAS com o código, sem comentários, sem marcações de linguagem (como html ou similares) e sem explicações adicionais. Comece com <!DOCTYPE html> e termine com </html>, mais nada.
`;
}

async function gerarImagemDoGrafico(htmlPath) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const fileUrl = `file://${htmlPath}`;
  await page.goto(fileUrl, { waitUntil: 'networkidle2' });

  const screenshotPath = path.join(path.dirname(htmlPath), 'grafico.png');
  await fs.ensureDir(path.dirname(screenshotPath));

  await page.screenshot({ path: screenshotPath, fullPage: true });

  await browser.close();
}