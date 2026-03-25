import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

// Import routes
import monitoringRoutes from './routes/monitoring.js';
import configRoutes from './routes/config.js';
import applyRoutes from './routes/apply.js';
import exportRoutes from './routes/export.js';
import parseRoutes from './routes/parse.js';
import nacenkaRoutes from './routes/nacenka.js';
import importDataRoutes from './routes/importData.js';
import siteDbRoutes from './routes/siteDb.js';
import avitoExportRoutes from './routes/avitoExport.js';
import newItemsRoutes from './routes/newItems.js';
import textGenRoutes from './routes/textGen.js';
import avitoCheckRoutes from './routes/avitoCheck.js';
import catalogRoutes from './routes/catalog.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve static files from client directory
app.use(express.static(path.join(__dirname, '../client')));

// API Routes
app.use('/api/monitor', monitoringRoutes);
app.use('/api/config', configRoutes);
app.use('/api/apply', applyRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/parse', parseRoutes);
app.use('/api/nacenka', nacenkaRoutes);
app.use('/api/import', importDataRoutes);
app.use('/api/site-db', siteDbRoutes);
app.use('/api/avito-export', avitoExportRoutes);
app.use('/api/new-items', newItemsRoutes);
app.use('/api/text-gen', textGenRoutes);
app.use('/api/avito-check', avitoCheckRoutes);
app.use('/api/catalog', catalogRoutes);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Все необработанные маршруты — JSON 404, не HTML
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handling middleware
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// Start server
const server = app.listen(PORT, () => {
  logger.info('Server started', { port: PORT, dashboard: `http://localhost:${PORT}` });
});
// Увеличиваем таймаут для долгих операций (парсинг Baikal, синхронизация SSH)
server.timeout = 10 * 60 * 1000; // 10 минут
