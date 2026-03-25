/**
 * API routes для конфигурации
 */

import express from 'express';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig, validateConfig, saveConfig, getPublicConfig, saveAvitoSourcesOnly } from '../../config/configManager.js';

const router = express.Router();

/**
 * POST /api/config/pick-db-file
 * Открывает проводник Windows (диалог выбора файла) и возвращает выбранный путь.
 * Запуск через start /wait чтобы окно диалога было в сессии пользователя и видимым.
 */
router.post('/pick-db-file', (req, res) => {
  if (os.platform() !== 'win32') {
    return res.status(400).json({
      error: 'Выбор через проводник доступен только в Windows. Укажите путь вручную.'
    });
  }
  const id = Date.now();
  const tmpDir = os.tmpdir();
  const scriptPath = path.join(tmpDir, `pick-db-${id}.ps1`);
  const resultPath = path.join(tmpDir, `pick-db-${id}.txt`);
  // Скрипт пишет путь в файл (только ASCII), т.к. при start /wait stdout не вернётся
  const script = [
    'param($ResultFile)',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$f = New-Object System.Windows.Forms.OpenFileDialog',
    '$f.Filter = "Database (*.db)|*.db|All files (*.*)|*.*"',
    '$f.Title = "Select database file"',
    'if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  $f.FileName | Set-Content -Path $ResultFile -Encoding utf8 -NoNewline',
    '}'
  ].join('\n');
  try {
    fs.writeFileSync(scriptPath, script, { encoding: 'ascii' });
    // start /wait — диалог открывается в видимой сессии пользователя
    execSync(`cmd /c start /wait powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" "${resultPath}"`, {
      encoding: 'utf8',
      timeout: 300000,
      windowsHide: false,
      stdio: 'ignore'
    });
    let selectedPath = '';
    if (fs.existsSync(resultPath)) {
      selectedPath = fs.readFileSync(resultPath, 'utf8').trim();
      try { fs.unlinkSync(resultPath); } catch (_) {}
    }
    try { fs.unlinkSync(scriptPath); } catch (_) {}
    if (!selectedPath) {
      return res.json({ cancelled: true });
    }
    res.json({ path: selectedPath });
  } catch (err) {
    if (fs.existsSync(scriptPath)) try { fs.unlinkSync(scriptPath); } catch (_) {}
    if (fs.existsSync(resultPath)) try { fs.unlinkSync(resultPath); } catch (_) {}
    // Если пользователь просто закрыл окно или система не даёт запустить PowerShell,
    // считаем, что выбор файла отменён, чтобы не показывать всплывающую ошибку в UI.
    if (err.killed || err.signal || err.message?.includes('Command failed')) {
      return res.json({ cancelled: true });
    }
    res.status(500).json({
      error: 'Ошибка вызова проводника',
      details: err.message
    });
  }
});

/**
 * PUT /api/config/sources
 * Сохраняет только источники Avito в файл (постоянно). Без проверки DB_PATH и т.д.
 */
router.put('/sources', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const sources = req.body?.avitoSources ?? req.body;
    const list = Array.isArray(sources) ? sources : [];
    await saveAvitoSourcesOnly(list);
    return res.status(200).json({ success: true, message: 'Источники сохранены' });
  } catch (error) {
    return res.status(500).json({
      error: 'Ошибка сохранения источников',
      details: error.message
    });
  }
});

/**
 * GET /api/config/avito-urls
 * Возвращает список источников (псевдоним + URL) и массив URL для совместимости
 */
router.get('/avito-urls', async (req, res) => {
  try {
    const config = await loadConfig();
    res.json({
      avitoSources: config.avitoSources || [],
      avitoUrls: (config.avitoSources || []).map(s => s.url)
    });
  } catch (error) {
    res.status(500).json({
      error: 'Ошибка загрузки конфигурации',
      details: error.message
    });
  }
});

/**
 * GET /api/config
 * Возвращает конфигурацию без секретов
 */
router.get('/', async (req, res) => {
  try {
    const config = await loadConfig();
    const publicConfig = getPublicConfig(config);
    res.json(publicConfig);
  } catch (error) {
    res.status(500).json({
      error: 'Ошибка загрузки конфигурации',
      details: error.message
    });
  }
});

/**
 * PUT /api/config
 * Сохраняет конфигурацию (avitoSources в файл, остальное в .env)
 */
router.put('/', async (req, res) => {
  try {
    const newConfig = req.body;
    const toValidate = {
      ...newConfig,
      avitoSources: newConfig.avitoSources || [],
      dbPath: newConfig.dbPath || './data/products.db',
      port: newConfig.port || 3002
    };
    const validation = validateConfig(toValidate);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Невалидная конфигурация',
        errors: validation.errors
      });
    }
    await saveConfig(toValidate);
    res.json({ success: true, message: 'Конфигурация успешно сохранена' });
  } catch (error) {
    res.status(500).json({
      error: 'Ошибка сохранения конфигурации',
      details: error.message
    });
  }
});

export default router;
