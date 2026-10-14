import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { ZodError, z } from 'zod';
import { Role } from '@prisma/client';

// Mock do prisma antes de importar os controladores e app
vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '../src/lib/prisma.js';
import { generateToken, verifyToken } from '../src/utils/jwt.js';
import { authMiddleware, requireRole } from '../src/middlewares/auth.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { login, getMe } from '../src/controllers/authController.js';
import { app } from '../src/app.js';
import { AuthenticatedRequest, TokenPayload } from '../src/types/index.js';
import { env } from '../src/config/env.js';

describe('Suíte de Testes - Módulo de Autenticação, Middlewares e Health Check', () => {
  // Silencia console.error durante a execução dos testes de erro propositais
  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('1. Utilitários JWT (src/utils/jwt.ts)', () => {
    const samplePayload: TokenPayload = {
      userId: 'user-uuid-123',
      email: 'admin@docsobs.com',
      role: Role.ADMIN,
      name: 'Admin Teste',
    };

    it('deve gerar um token JWT válido contendo os dados do payload', () => {
      const token = generateToken(samplePayload);
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3);

      const decoded = verifyToken(token);
      expect(decoded.userId).toBe(samplePayload.userId);
      expect(decoded.email).toBe(samplePayload.email);
      expect(decoded.role).toBe(samplePayload.role);
      expect(decoded.name).toBe(samplePayload.name);
    });

    it('deve lançar JsonWebTokenError ao verificar token JWT corrompido ou inválido', () => {
      expect(() => {
        verifyToken('token.invalido.completamente-incorreto');
      }).toThrow(jwt.JsonWebTokenError);
    });

    it('deve lançar TokenExpiredError ao verificar token JWT expirado', () => {
      const secret = env.JWT_SECRET;
      const expiredToken = jwt.sign(samplePayload, secret, { expiresIn: '-1s' });

      expect(() => {
        verifyToken(expiredToken);
      }).toThrow(jwt.TokenExpiredError);
    });
  });

  describe('2. Middlewares de Autenticação e RBAC (src/middlewares/auth.ts)', () => {
    let mockReq: Partial<AuthenticatedRequest>;
    let mockRes: Partial<Response>;
    let nextFunction: NextFunction;

    beforeEach(() => {
      mockReq = {
        headers: {},
      };
      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      nextFunction = vi.fn();
    });

    describe('authMiddleware', () => {
      it('deve retornar 401 UNAUTHORIZED se o header Authorization estiver ausente', () => {
        mockReq.headers = {};

        authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, nextFunction);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'UNAUTHORIZED',
          message: 'Token de autenticação não fornecido ou em formato inválido.',
        });
        expect(nextFunction).not.toHaveBeenCalled();
      });

      it('deve retornar 401 UNAUTHORIZED se o prefixo "Bearer " não for utilizado', () => {
        mockReq.headers = {
          authorization: 'Basic token123',
        };

        authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, nextFunction);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'UNAUTHORIZED',
          message: 'Token de autenticação não fornecido ou em formato inválido.',
        });
        expect(nextFunction).not.toHaveBeenCalled();
      });

      it('deve retornar 401 INVALID_TOKEN se o token JWT for inválido', () => {
        mockReq.headers = {
          authorization: 'Bearer token-invalido-xyz',
        };

        authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, nextFunction);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'INVALID_TOKEN',
          message: 'Token de autenticação inválido ou expirado.',
        });
        expect(nextFunction).not.toHaveBeenCalled();
      });

      it('deve chamar next() e popular req.user quando o token JWT for válido', () => {
        const payload: TokenPayload = {
          userId: 'user-1',
          email: 'user@docsobs.com',
          role: Role.OPERATIONAL,
          name: 'Operador 1',
        };
        const token = generateToken(payload);
        mockReq.headers = {
          authorization: `Bearer ${token}`,
        };

        authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, nextFunction);

        expect(nextFunction).toHaveBeenCalled();
        expect(mockReq.user).toBeDefined();
        expect(mockReq.user?.userId).toBe(payload.userId);
        expect(mockReq.user?.email).toBe(payload.email);
        expect(mockReq.user?.role).toBe(Role.OPERATIONAL);
      });
    });

    describe('requireRole (Controle de Acesso Baseado em Perfis - RBAC)', () => {
      it('deve retornar 401 UNAUTHORIZED se req.user for indefinido', () => {
        mockReq.user = undefined;
        const middleware = requireRole([Role.ADMIN]);

        middleware(mockReq as AuthenticatedRequest, mockRes as Response, nextFunction);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'UNAUTHORIZED',
          message: 'Usuário não autenticado.',
        });
        expect(nextFunction).not.toHaveBeenCalled();
      });

      it('deve retornar 403 FORBIDDEN se a role do usuário não pertencer às permitidas', () => {
        mockReq.user = {
          userId: 'op-1',
          email: 'op@docsobs.com',
          role: Role.OPERATIONAL,
          name: 'Operador',
        };

        const middleware = requireRole([Role.ADMIN]);

        middleware(mockReq as AuthenticatedRequest, mockRes as Response, nextFunction);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'FORBIDDEN',
          message: 'Acesso negado. Seu perfil não possui permissão para este recurso.',
        });
        expect(nextFunction).not.toHaveBeenCalled();
      });

      it('deve permitir a requisição chamando next() se a role do usuário for permitida', () => {
        mockReq.user = {
          userId: 'admin-1',
          email: 'admin@docsobs.com',
          role: Role.ADMIN,
          name: 'Admin Master',
        };

        const middleware = requireRole([Role.ADMIN, Role.OPERATIONAL]);

        middleware(mockReq as AuthenticatedRequest, mockRes as Response, nextFunction);

        expect(nextFunction).toHaveBeenCalled();
        expect(mockRes.status).not.toHaveBeenCalled();
      });
    });
  });

  describe('3. Middleware Central de Tratamento de Erros (src/middlewares/errorHandler.ts)', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let nextFunction: NextFunction;

    beforeEach(() => {
      mockReq = {};
      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      nextFunction = vi.fn();
    });

    it('deve tratar ZodError retornando 400 VALIDATION_ERROR formatado', () => {
      const schema = z.object({ email: z.string().email() });
      let zodErr: ZodError | null = null;
      try {
        schema.parse({ email: 'invalido' });
      } catch (err: any) {
        zodErr = err;
      }

      errorHandler(zodErr, mockReq as Request, mockRes as Response, nextFunction);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: 'Dados enviados são inválidos.',
          details: expect.arrayContaining([
            expect.objectContaining({
              path: 'email',
            }),
          ]),
        })
      );
    });

    it('deve tratar erros genéricos com status customizado', () => {
      const customErr = {
        status: 404,
        code: 'NOT_FOUND',
        message: 'Recurso não encontrado.',
      };

      errorHandler(customErr, mockReq as Request, mockRes as Response, nextFunction);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'NOT_FOUND',
        message: 'Recurso não encontrado.',
      });
    });

    it('deve retornar 500 INTERNAL_SERVER_ERROR para erros sem status definido', () => {
      const genericErr = new Error('Falha catastrófica');

      errorHandler(genericErr, mockReq as Request, mockRes as Response, nextFunction);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Falha catastrófica',
      });
    });
  });

  describe('4. Health Check Endpoint (GET /api/v1/health)', () => {
    it('deve retornar status 200 com informações de saúde do serviço', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('service', 'docsobs-backend');
      expect(res.body).toHaveProperty('timestamp');
      expect(new Date(res.body.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('5. Auth Endpoints Integration (Supertest & App)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    describe('POST /api/v1/auth/login', () => {
      it('deve retornar 400 se o corpo da requisição for vazio', async () => {
        const res = await request(app)
          .post('/api/v1/auth/login')
          .send({});

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error', 'VALIDATION_ERROR');
        expect(res.body).toHaveProperty('details');
        expect(Array.isArray(res.body.details)).toBe(true);
      });

      it('deve retornar 400 se o e-mail tiver formato inválido', async () => {
        const res = await request(app)
          .post('/api/v1/auth/login')
          .send({
            email: 'email-invalido',
            password: 'senha123',
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('VALIDATION_ERROR');
        expect(res.body.details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: 'email',
              message: 'E-mail em formato inválido.',
            }),
          ])
        );
      });

      it('deve retornar 400 se a senha for vazia', async () => {
        const res = await request(app)
          .post('/api/v1/auth/login')
          .send({
            email: 'admin@docsobs.com',
            password: '',
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('VALIDATION_ERROR');
        expect(res.body.details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: 'password',
              message: 'A senha é obrigatória.',
            }),
          ])
        );
      });

      it('deve retornar 401 se o usuário não for encontrado no banco de dados', async () => {
        (prisma.user.findUnique as any).mockResolvedValue(null);

        const res = await request(app)
          .post('/api/v1/auth/login')
          .send({
            email: 'inexistente@docsobs.com',
            password: 'senha123',
          });

        expect(res.status).toBe(401);
        expect(res.body).toEqual({
          error: 'INVALID_CREDENTIALS',
          message: 'E-mail ou senha incorretos, ou usuário inativo.',
        });
        expect(prisma.user.findUnique).toHaveBeenCalledWith({
          where: { email: 'inexistente@docsobs.com' },
        });
      });

      it('deve retornar 401 se o usuário estiver inativo (isActive = false)', async () => {
        (prisma.user.findUnique as any).mockResolvedValue({
          id: 'user-inativo-1',
          name: 'Usuário Inativo',
          email: 'inativo@docsobs.com',
          passwordHash: await bcrypt.hash('senha123', 10),
          role: Role.OPERATIONAL,
          isActive: false,
        });

        const res = await request(app)
          .post('/api/v1/auth/login')
          .send({
            email: 'inativo@docsobs.com',
            password: 'senha123',
          });

        expect(res.status).toBe(401);
        expect(res.body).toEqual({
          error: 'INVALID_CREDENTIALS',
          message: 'E-mail ou senha incorretos, ou usuário inativo.',
        });
      });

      it('deve retornar 401 se a senha fornecida for incorreta', async () => {
        const passwordHash = await bcrypt.hash('senhaCorreta123', 10);
        (prisma.user.findUnique as any).mockResolvedValue({
          id: 'user-1',
          name: 'Admin Teste',
          email: 'admin@docsobs.com',
          passwordHash,
          role: Role.ADMIN,
          isActive: true,
        });

        const res = await request(app)
          .post('/api/v1/auth/login')
          .send({
            email: 'admin@docsobs.com',
            password: 'senhaErrada',
          });

        expect(res.status).toBe(401);
        expect(res.body).toEqual({
          error: 'INVALID_CREDENTIALS',
          message: 'E-mail ou senha incorretos.',
        });
      });

      it('deve realizar login com sucesso, retornando token JWT e dados do usuário (sem passwordHash)', async () => {
        const plainPassword = 'password123';
        const passwordHash = await bcrypt.hash(plainPassword, 10);
        (prisma.user.findUnique as any).mockResolvedValue({
          id: 'user-uuid-999',
          name: 'Administrador Geral',
          email: 'admin@docsobs.com',
          passwordHash,
          role: Role.ADMIN,
          isActive: true,
        });

        const res = await request(app)
          .post('/api/v1/auth/login')
          .send({
            email: 'ADMIN@DOCSOBS.COM', // Valida normalização para lowercase
            password: plainPassword,
          });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('message', 'Login realizado com sucesso.');
        expect(res.body).toHaveProperty('token');
        expect(res.body.user).toEqual({
          id: 'user-uuid-999',
          name: 'Administrador Geral',
          email: 'admin@docsobs.com',
          role: 'ADMIN',
        });
        expect(res.body.user.passwordHash).toBeUndefined();

        // Valida payload do token gerado
        const decoded = verifyToken(res.body.token);
        expect(decoded.userId).toBe('user-uuid-999');
        expect(decoded.email).toBe('admin@docsobs.com');
        expect(decoded.role).toBe(Role.ADMIN);
        expect(decoded.name).toBe('Administrador Geral');
      });

      it('deve propagar erro 500 via errorHandler se ocorrer falha inesperada no banco', async () => {
        (prisma.user.findUnique as any).mockRejectedValue(new Error('Falha de conexão com o PostgreSQL'));

        const res = await request(app)
          .post('/api/v1/auth/login')
          .send({
            email: 'admin@docsobs.com',
            password: 'password123',
          });

        expect(res.status).toBe(500);
        expect(res.body).toEqual({
          error: 'INTERNAL_SERVER_ERROR',
          message: 'Falha de conexão com o PostgreSQL',
        });
      });
    });

    describe('GET /api/v1/auth/me', () => {
      it('deve retornar 401 se nenhum token for fornecido no header Authorization', async () => {
        const res = await request(app).get('/api/v1/auth/me');

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('UNAUTHORIZED');
      });

      it('deve retornar 401 se um token inválido/corrompido for fornecido', async () => {
        const res = await request(app)
          .get('/api/v1/auth/me')
          .set('Authorization', 'Bearer token_invalido_xyz');

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('INVALID_TOKEN');
      });

      it('deve retornar 404 se o usuário do token não for encontrado no banco de dados', async () => {
        const token = generateToken({
          userId: 'user-inexistente',
          email: 'inexistente@docsobs.com',
          role: Role.OPERATIONAL,
          name: 'Inexistente',
        });

        (prisma.user.findUnique as any).mockResolvedValue(null);

        const res = await request(app)
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(404);
        expect(res.body).toEqual({
          error: 'USER_NOT_FOUND',
          message: 'Usuário não encontrado ou inativo.',
        });
      });

      it('deve retornar 404 se o usuário estiver marcado como inativo no banco', async () => {
        const token = generateToken({
          userId: 'user-inativo',
          email: 'inativo@docsobs.com',
          role: Role.OPERATIONAL,
          name: 'Inativo',
        });

        (prisma.user.findUnique as any).mockResolvedValue({
          id: 'user-inativo',
          name: 'Inativo',
          email: 'inativo@docsobs.com',
          role: Role.OPERATIONAL,
          isActive: false,
          createdAt: new Date().toISOString(),
        });

        const res = await request(app)
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(404);
        expect(res.body.error).toBe('USER_NOT_FOUND');
      });

      it('deve retornar 200 com os dados do perfil do usuário autenticado', async () => {
        const createdAt = new Date().toISOString();
        const token = generateToken({
          userId: 'user-valido',
          email: 'valido@docsobs.com',
          role: Role.ADMIN,
          name: 'Usuario Valido',
        });

        (prisma.user.findUnique as any).mockResolvedValue({
          id: 'user-valido',
          name: 'Usuario Valido',
          email: 'valido@docsobs.com',
          role: Role.ADMIN,
          isActive: true,
          createdAt,
        });

        const res = await request(app)
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          user: {
            id: 'user-valido',
            name: 'Usuario Valido',
            email: 'valido@docsobs.com',
            role: 'ADMIN',
            isActive: true,
            createdAt,
          },
        });
        expect(prisma.user.findUnique).toHaveBeenCalledWith({
          where: { id: 'user-valido' },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
        });
      });

      it('deve retornar 500 se ocorrer um erro inesperado ao buscar dados em /me', async () => {
        const token = generateToken({
          userId: 'user-db-err',
          email: 'dberr@docsobs.com',
          role: Role.ADMIN,
          name: 'DB Err User',
        });

        (prisma.user.findUnique as any).mockRejectedValue(new Error('Erro no pool de conexões'));

        const res = await request(app)
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('INTERNAL_SERVER_ERROR');
      });

      it('deve retornar 401 se getMe for executado diretamente sem req.user definido', async () => {
        const mockReqDirect: Partial<AuthenticatedRequest> = { user: undefined };
        const mockResDirect: Partial<Response> = {
          status: vi.fn().mockReturnThis(),
          json: vi.fn().mockReturnThis(),
        };
        const mockNextDirect = vi.fn();

        await getMe(mockReqDirect as AuthenticatedRequest, mockResDirect as Response, mockNextDirect);

        expect(mockResDirect.status).toHaveBeenCalledWith(401);
        expect(mockResDirect.json).toHaveBeenCalledWith({
          error: 'UNAUTHORIZED',
          message: 'Não autorizado.',
        });
      });
    });

    describe('6. Simulação de Rota com Proteção RBAC (Supertest)', () => {
      const rbacApp = express();
      rbacApp.use(express.json());

      rbacApp.get(
        '/api/v1/admin-resource',
        authMiddleware,
        requireRole([Role.ADMIN]),
        (req: Request, res: Response) => {
          res.status(200).json({ message: 'Acesso autorizado para Administradores.' });
        }
      );

      rbacApp.get(
        '/api/v1/operational-or-admin',
        authMiddleware,
        requireRole([Role.ADMIN, Role.OPERATIONAL]),
        (req: Request, res: Response) => {
          res.status(200).json({ message: 'Acesso liberado para ambos os perfis.' });
        }
      );

      it('deve permitir acesso à rota exclusiva de ADMIN para usuário ADMIN', async () => {
        const adminToken = generateToken({
          userId: 'admin-1',
          email: 'admin@docsobs.com',
          role: Role.ADMIN,
          name: 'Admin Master',
        });

        const res = await request(rbacApp)
          .get('/api/v1/admin-resource')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Acesso autorizado para Administradores.');
      });

      it('deve retornar 403 Forbidden para usuário OPERATIONAL em rota exclusiva de ADMIN', async () => {
        const opToken = generateToken({
          userId: 'op-1',
          email: 'op@docsobs.com',
          role: Role.OPERATIONAL,
          name: 'Operador',
        });

        const res = await request(rbacApp)
          .get('/api/v1/admin-resource')
          .set('Authorization', `Bearer ${opToken}`);

        expect(res.status).toBe(403);
        expect(res.body).toEqual({
          error: 'FORBIDDEN',
          message: 'Acesso negado. Seu perfil não possui permissão para este recurso.',
        });
      });

      it('deve permitir acesso à rota compartilhada para perfil OPERATIONAL', async () => {
        const opToken = generateToken({
          userId: 'op-1',
          email: 'op@docsobs.com',
          role: Role.OPERATIONAL,
          name: 'Operador',
        });

        const res = await request(rbacApp)
          .get('/api/v1/operational-or-admin')
          .set('Authorization', `Bearer ${opToken}`);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Acesso liberado para ambos os perfis.');
      });

      it('deve retornar 401 Unauthorized em rota protegida quando token não é fornecido', async () => {
        const res = await request(rbacApp).get('/api/v1/admin-resource');

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('UNAUTHORIZED');
      });
    });
  });
});
