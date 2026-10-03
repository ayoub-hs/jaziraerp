import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDb } from './db/index.js';
import { materialsRouter } from './routes/materials.js';
import { formulationsRouter } from './routes/formulations.js';
import { productsRouter } from './routes/products.js';
import { productionRouter } from './routes/production.js';
import { customersRouter } from './routes/customers.js';
import { suppliersRouter, purchasesRouter } from './routes/suppliers.js';
import { containersRouter } from './routes/containers.js';
import { registerRouter } from './routes/register.js';
import { salesRouter, refundsRouter } from './routes/sales.js';
import { inventoryRouter } from './routes/inventory.js';
import { accountingRouter } from './routes/accounting.js';
import { syncRouter } from './routes/sync.js';
import { authRouter } from './routes/auth.js';
import { backupRouter } from './routes/backup.js';
import { hardwareRouter } from './routes/hardware.js';
import { categoriesRouter } from './routes/categories.js';
import { reportsRouter } from './routes/reports.js';
import { backupService } from './services/backupService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : [];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  }
}));
app.use(express.json({ limit: '10mb' }));

// Initialize SQLite database schema
getDb();
if (process.env.NODE_ENV !== 'test') {
  backupService.startDailySchedule();
}

// Routes
app.use('/api/auth', authRouter);
app.use('/api/backups', backupRouter);
app.use('/api/materials', materialsRouter);
app.use('/api/formulations', formulationsRouter);
app.use('/api/products', productsRouter);
app.use('/api/production', productionRouter);
app.use('/api/customers', customersRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/containers', containersRouter);
app.use('/api/register', registerRouter);
app.use('/api/sales', salesRouter);
app.use('/api/refunds', refundsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/accounting', accountingRouter);
app.use('/api/sync', syncRouter);
app.use('/api/hardware', hardwareRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/reports', reportsRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Fallback for unhandled /api routes
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.path}` });
});

// Serve frontend static build if available
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
}

// Global Express error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Unhandled Server Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Start server if executed directly
const HOST = process.env.HOST || '0.0.0.0';
if (process.env.NODE_ENV !== 'test') {
  app.listen(Number(PORT), HOST, () => {
    console.log(`[Al Jazira ERP] Server running on http://${HOST}:${PORT} (accessible from local network)`);
  });
}

export default app;
