/**
 * Модуль управления конфигурацией приложения
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadAvitoSources } from './avitoSources.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Загружает конфигурацию из .env и data/avito-sources.json.
 * .env перечитывается с override, чтобы после сохранения настроек в UI использовался актуальный путь к БД.
 * @returns {Promise<Object>} Объект конфигурации
 */
export async function loadConfig() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  dotenv.config({ path: envPath, override: true });
  const sources = await loadAvitoSources();
  const avitoUrls = sources.map(s => s.url);

  return {
    avitoSources: sources,
    avitoUrls,
    siteApiUrl: process.env.SITE_API_URL || '',
    dbPath: process.env.DB_PATH || './data/products.db',
    bearerToken: process.env.BEARER_TOKEN || '',
    port: parseInt(process.env.PORT || '3000', 10),
    sshHost: process.env.SSH_HOST || '',
    sshPort: parseInt(process.env.SSH_PORT || '22', 10),
    sshUser: process.env.SSH_USER || '',
    sshKeyPath: process.env.SSH_KEY_PATH || '',
    sshDbPath: process.env.SSH_DB_PATH || '',
    localSiteDbPath: process.env.LOCAL_SITE_DB_PATH || '',
    catalogDbPath: process.env.CATALOG_DB_PATH || '',
    catalogBaseUrl: process.env.CATALOG_BASE_URL || '',
    r2AccountId: process.env.R2_ACCOUNT_ID || '',
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    r2BucketName: process.env.R2_BUCKET_NAME || '',
    r2PublicUrl: process.env.R2_PUBLIC_URL || '',
  };
}

/**
 * Валидирует конфигурацию
 * @param {Object} config - Объект конфигурации
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateConfig(config) {
  const errors = [];

  if (config.dbPath) {
    const dbDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dbDir)) {
      errors.push(`Директория БД не существует: ${dbDir}`);
    }
  } else {
    errors.push('DB_PATH не указан');
  }

  if (config.avitoSources && config.avitoSources.length > 0) {
    config.avitoSources.forEach((s, index) => {
      if (!s || typeof s !== 'object') return;
      if (!s.alias || !s.alias.trim()) {
        errors.push(`Источник ${index + 1}: укажите псевдоним`);
      }
      try {
        new URL(s.url);
        if (!s.url.includes('avito.ru')) {
          errors.push(`Источник "${s.alias}": URL не Avito`);
        }
      } catch (e) {
        errors.push(`Источник "${s.alias || index + 1}": невалидный URL`);
      }
    });
  }

  if (config.siteApiUrl) {
    try {
      new URL(config.siteApiUrl);
    } catch (e) {
      errors.push(`Невалидный SITE_API_URL: ${config.siteApiUrl}`);
    }
  }

  if (isNaN(config.port) || config.port < 1 || config.port > 65535) {
    errors.push(`Невалидный PORT: ${config.port}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Сохраняет только источники Avito в data/avito-sources.json (без валидации DB_PATH и т.д.)
 * @param {Object[]} avitoSources
 * @returns {Promise<void>}
 */
export async function saveAvitoSourcesOnly(avitoSources) {
  if (!Array.isArray(avitoSources)) return;
  const { saveAvitoSources } = await import('./avitoSources.js');
  await saveAvitoSources(avitoSources);
}

/**
 * Сохраняет конфигурацию: сначала источники в файл, затем .env (если валидация пройдена)
 * Источники сохраняются всегда; при ошибке валидации остального — источники уже записаны.
 * @param {Object} config - Объект конфигурации (в т.ч. avitoSources)
 * @returns {Promise<void>}
 */
export async function saveConfig(config) {
  if (Array.isArray(config.avitoSources)) {
    await saveAvitoSourcesOnly(config.avitoSources);
  }

  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(`Невалидная конфигурация: ${validation.errors.join(', ')}`);
  }

  const dbPath = config.dbPath || './data/products.db';
  const dbTable = (dbPath && dbPath.includes('diski_sait')) ? 'VSE4' : 'products';
  const envPath = path.join(__dirname, '../../.env');
  const envContent = [
    `# Site API Configuration`,
    `SITE_API_URL=${config.siteApiUrl || ''}`,
    `BEARER_TOKEN=${config.bearerToken || ''}`,
    ``,
    `# Database`,
    `DB_PATH=${dbPath}`,
    `DB_TABLE=${dbTable}`,
    ``,
    `# Server`,
    `PORT=${config.port || 3002}`,
    ``,
    `# SSH (доступ к БД сайта)`,
    `SSH_HOST=${config.sshHost || ''}`,
    `SSH_PORT=${config.sshPort || 22}`,
    `SSH_USER=${config.sshUser || ''}`,
    `SSH_KEY_PATH=${config.sshKeyPath || ''}`,
    `SSH_DB_PATH=${config.sshDbPath || ''}`,
    ``,
    `# Путь к локальной копии БД сайта (для синхронизации)`,
    `LOCAL_SITE_DB_PATH=${config.localSiteDbPath || ''}`,
    ``
  ].join('\n');
  await fs.promises.writeFile(envPath, envContent, 'utf8');
}

/**
 * Возвращает конфигурацию без секретов (для API)
 * @param {Object} config - Полная конфигурация
 * @returns {Object} Конфигурация без секретов
 */
export function getPublicConfig(config) {
  return {
    avitoSources: config.avitoSources || [],
    avitoUrls: (config.avitoSources || []).map(s => s.url),
    siteApiUrl: config.siteApiUrl,
    dbPath: config.dbPath,
    port: config.port,
    sshHost: config.sshHost || '',
    sshPort: config.sshPort || 22,
    sshUser: config.sshUser || '',
    sshDbPath: config.sshDbPath || '',
    localSiteDbPath: config.localSiteDbPath || ''
    // sshKeyPath — намеренно не возвращаем в публичный конфиг
  };
}
