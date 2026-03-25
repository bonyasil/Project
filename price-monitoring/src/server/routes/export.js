/**
 * API routes для экспорта данных
 */

import express from 'express';
import { generateNewItemsExcel } from '../../export/excelExport.js';
import { lastMonitoringResult } from './monitoring.js';
import { logger } from '../logger.js';

const router = express.Router();

/**
 * GET /api/export/new-items
 * Экспортирует новые товары в Excel
 */
router.get('/new-items', async (req, res) => {
  try {
    // Получаем результаты последнего мониторинга
    if (!lastMonitoringResult || !lastMonitoringResult.newItems) {
      return res.status(404).json({ 
        error: 'Нет данных для экспорта. Запустите мониторинг сначала.' 
      });
    }
    
    const newItems = lastMonitoringResult.newItems;
    
    if (newItems.length === 0) {
      return res.status(404).json({ 
        error: 'Новые товары не найдены' 
      });
    }
    
    // Генерируем Excel файл
    logger.info('Export new-items Excel', { count: newItems.length });
    const buffer = await generateNewItemsExcel(newItems);
    logger.info('Export completed');
    
    // Устанавливаем headers для скачивания
    const filename = `new-items-${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    
    // Отправляем Buffer
    res.send(buffer);
    
  } catch (error) {
    logger.error('Export failed', { error: error.message });
    res.status(500).json({ 
      error: 'Ошибка генерации Excel файла',
      details: error.message 
    });
  }
});

export default router;
