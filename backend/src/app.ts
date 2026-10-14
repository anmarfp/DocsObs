import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { authRouter } from './routes/authRoutes.js';
import { documentRouter } from './routes/documentRoutes.js';
import { userRouter } from './routes/userRoutes.js';
import { companyRouter } from './routes/companyRoutes.js';
import { categoryRouter } from './routes/categoryRoutes.js';
import { auditRouter } from './routes/auditRoutes.js';
import { notificationRouter } from './routes/notificationRoutes.js';
import { calendarRouter } from './routes/calendarRoutes.js';
import { dashboardRouter } from './routes/dashboardRoutes.js';
import { reportRouter } from './routes/reportRoutes.js';
import { authMiddleware } from './middlewares/auth.js';
import { errorHandler } from './middlewares/errorHandler.js';
import {
  UPLOADS_DIR,
  rejectDisallowedUploadExtension,
  setAttachmentHeaders,
} from './services/storageService.js';

export const app = express();

// Middlewares Globais
// helmet: cabeçalhos de segurança (nosniff, frameguard, HSTS etc.). A API só
// devolve JSON/arquivos, então a CSP é restritiva: nada pode ser carregado ou
// executado a partir de respostas deste servidor. O SPA é servido pelo Nginx.
// crossOriginResourcePolicy fica no padrão `same-origin`: o frontend acessa a
// API pelo mesmo origin (proxy do Vite em dev e do Nginx em produção).
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        sandbox: [],
      },
    },
  })
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rota de Health Check
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'docsobs-backend',
  });
});

// Armazenamento de Arquivos Estáticos Protegido por Autenticação
// Anexos: só extensões allow-listed; sempre servidos como download (attachment),
// com Content-Type fixo pela extensão e X-Content-Type-Options: nosniff (DOC-34).
app.use(
  '/api/v1/uploads',
  authMiddleware,
  rejectDisallowedUploadExtension,
  express.static(UPLOADS_DIR, {
    index: false,
    dotfiles: 'deny',
    redirect: false,
    setHeaders: (res, filePath) => setAttachmentHeaders(res, filePath),
  })
);

// Rotas da API
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/documents', documentRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/company', companyRouter);
app.use('/api/v1/categories', categoryRouter);
app.use('/api/v1/audit-logs', auditRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/calendar', calendarRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/reports', reportRouter);

// Middleware Central de Erros
app.use(errorHandler);
