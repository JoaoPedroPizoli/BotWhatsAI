import fs from 'fs-extra';
import { parse } from 'csv-parse';
import Database from 'better-sqlite3';
import config from '../config/index.js';

const csvParse = parse;
let db;

function parseCSV(csvString) {
  return new Promise((resolve, reject) => {
    csvParse(csvString, { delimiter: ',', relax_quotes: true }, (err, output) => {
      if (err) {
        return reject(err);
      }
      resolve(output);
    });
  });
}


function normalizeColumnName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/gi, '_');
}

export async function createOrRecreateDatabaseFromCSV(csvFilePath) {
  try {
    const fileContent = fs.readFileSync(csvFilePath, 'utf8');
    const records = await parseCSV(fileContent);

    if (!records || records.length === 0) {
      throw new Error('O arquivo CSV está vazio ou não pôde ser lido corretamente.');
    }

    const headers = records[0];
    const dataRows = records.slice(1);

    db = new Database(':memory:');

    const createTableSQL = `
      CREATE TABLE NOME_DA_TABLE (
        ${headers
          .map((h) => {
            const colName = normalizeColumnName(h);
            return colName === 'data' ? `${colName} DATE` : `${colName} TEXT`;
          })
          .join(',')}
      )
    `;
    db.exec(createTableSQL);


    const insertSQL = `INSERT INTO NOME_DA_TABLE VALUES (${headers.map(() => '?').join(',')})`;
    const insertStmt = db.prepare(insertSQL);

    const dataIndex = headers.findIndex((h) => normalizeColumnName(h) === 'data');


    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        if (dataIndex !== -1 && row[dataIndex]) {
          const [dd, mm, yyyy] = row[dataIndex].split('-');
          if (dd && mm && yyyy) {
            row[dataIndex] = `${yyyy}-${mm}-${dd}`;
          }
        }
        insertStmt.run(row);
      }
    });
    insertMany(dataRows);

    console.log(`Banco de dados criado/recriado a partir de: ${csvFilePath}`);
  } catch (error) {
    console.error('Erro ao criar/recriar o banco de dados:', error);
  }
}


export function queryDatabase(sqlQuery) {
  if (!db) {
    console.error('Banco de dados ainda não foi inicializado.');
    return;
  }

  try {
    const result = db.prepare(sqlQuery).all();
    return result;
  } catch (error) {
    console.error('Erro ao executar a query SQL:', error);
    return;
  }
}


export function monitorCSVFile(csvPath = config.paths.csv) {
  fs.watchFile(csvPath, { interval: 5000 }, async (curr, prev) => {
    if (curr.mtime > prev.mtime) {
      console.time("CSV Reload Time");
      console.log('🔄 CSV modificado. Recriando banco...');
      await createOrRecreateDatabaseFromCSV(csvPath);
      console.timeEnd("CSV Reload Time");
    }
  });
  console.log(`📊 Monitoramento do arquivo CSV iniciado: ${csvPath}`);
}