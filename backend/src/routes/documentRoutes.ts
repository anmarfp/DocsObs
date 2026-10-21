import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware, requireRole } from '../middlewares/auth.js';
import { upload, uploadMemory } from '../services/storageService.js';
import {
  createDocument,
  extractDocumentFields,
  listDocuments,
  getDocumentById,
  updateDocument,
  toggleArchive,
  deleteDocument,
  renewDocument,
  getDocumentVersions,
} from '../controllers/documentController.js';

export const documentRouter = Router();

// Todas as rotas de documentos exigem autenticação prévia
documentRouter.use(authMiddleware);

// 1. Criação de documento (com upload opcional de anexo)
documentRouter.post('/', upload.single('attachment'), createDocument);

// 1.1 Extração automática de campos a partir do anexo (em memória, sem persistência)
documentRouter.post('/extract', uploadMemory.single('attachment'), extractDocumentFields);

// 2. Listagem de documentos com filtros (categoria, status, busca e arquivados)
documentRouter.get('/', listDocuments);

// 3. Detalhes de um documento específico por ID
documentRouter.get('/:id', getDocumentById);

// 4. Atualização de documento (com upload opcional de novo anexo)
documentRouter.put('/:id', upload.single('attachment'), updateDocument);

// 5. Alternar status de arquivamento (Soft Delete / Unarchive)
documentRouter.patch('/:id/archive', toggleArchive);

// 6. Renovação de documento com criação de snapshot histórico e anexo
documentRouter.post('/:id/renew', upload.single('attachment'), renewDocument);

// 7. Histórico cronológico de versões de um documento
documentRouter.get('/:id/versions', getDocumentVersions);

// 8. Exclusão permanente do documento (Hard Delete restrito a Administradores)
documentRouter.delete('/:id', requireRole([Role.ADMIN]), deleteDocument);
