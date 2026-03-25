/**
 * Хранение источников Avito: URL + псевдоним
 * Файл: data/avito-sources.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCES_FILE = path.join(__dirname, '../../data/avito-sources.json');

/**
 * @typedef {{ id: string, alias: string, url: string }} AvitoSource
 */

/**
 * Загружает список источников Avito из файла
 * @returns {Promise<AvitoSource[]>}
 */
export async function loadAvitoSources() {
  try {
    const raw = await fs.promises.readFile(SOURCES_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

/**
 * Сохраняет список источников в файл
 * @param {AvitoSource[]} sources
 */
export async function saveAvitoSources(sources) {
  const dir = path.dirname(SOURCES_FILE);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
  await fs.promises.writeFile(
    SOURCES_FILE,
    JSON.stringify(sources, null, 2),
    'utf8'
  );
}

/**
 * Возвращает URL по псевдониму
 * @param {AvitoSource[]} sources
 * @param {string} alias
 * @returns {string|undefined}
 */
export function getUrlByAlias(sources, alias) {
  const found = sources.find(s => s.alias === alias);
  return found ? found.url : undefined;
}
