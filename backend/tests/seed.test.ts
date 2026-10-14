import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  MIN_PRODUCTION_SEED_PASSWORD_LENGTH,
  SeedConfigError,
  assertSeedEnv,
  generateSeedPassword,
  resolveSeedPassword,
  shouldSeedDemoData,
  validateSeedEnv,
} from '../prisma/seed.js';

const strong = 'x'.repeat(MIN_PRODUCTION_SEED_PASSWORD_LENGTH);

describe('Seed - resolução de senhas (DOC-32)', () => {
  it('não versiona nenhuma senha literal no seed', () => {
    const source = readFileSync(new URL('../prisma/seed.ts', import.meta.url), 'utf-8');
    expect(source).not.toMatch(/Admin123|Operacional123|Seed123/);
    expect(source).not.toMatch(/SEED_PASSWORD\s*\|\|/);
  });

  describe('produção', () => {
    it('falha nomeando as variáveis ausentes quando nenhuma senha é definida', () => {
      const env = { NODE_ENV: 'production' };
      expect(validateSeedEnv(env)).toEqual([
        'ADMIN_SEED_PASSWORD não definida',
        'OPERATIONAL_SEED_PASSWORD não definida',
      ]);
      expect(() => assertSeedEnv(env)).toThrow(SeedConfigError);
      expect(() => assertSeedEnv(env)).toThrow(/ADMIN_SEED_PASSWORD.*OPERATIONAL_SEED_PASSWORD.*RUN_SEED=false/s);
    });

    it('trata string vazia ou só espaços (padrão do compose) como ausente', () => {
      const env = { NODE_ENV: 'production', ADMIN_SEED_PASSWORD: '', OPERATIONAL_SEED_PASSWORD: '   ' };
      expect(validateSeedEnv(env)).toHaveLength(2);
      expect(() => resolveSeedPassword(env, 'ADMIN_SEED_PASSWORD')).toThrow(SeedConfigError);
    });

    it('rejeita senhas abaixo do tamanho mínimo', () => {
      const env = { NODE_ENV: 'production', ADMIN_SEED_PASSWORD: 'curta', OPERATIONAL_SEED_PASSWORD: strong };
      expect(validateSeedEnv(env)).toEqual([
        `ADMIN_SEED_PASSWORD deve ter ao menos ${MIN_PRODUCTION_SEED_PASSWORD_LENGTH} caracteres`,
      ]);
    });

    it('aceita senhas explícitas e não cria dados de demonstração', () => {
      const env = { NODE_ENV: 'production', ADMIN_SEED_PASSWORD: strong, OPERATIONAL_SEED_PASSWORD: `${strong}!` };
      expect(() => assertSeedEnv(env)).not.toThrow();
      expect(resolveSeedPassword(env, 'ADMIN_SEED_PASSWORD')).toEqual({ password: strong, generated: false });
      expect(shouldSeedDemoData(env)).toBe(false);
      // DEMO_SEED_PASSWORD nunca é necessária em produção, pois não há usuários demo.
      expect(() => resolveSeedPassword(env, 'DEMO_SEED_PASSWORD')).toThrow(SeedConfigError);
    });
  });

  describe('fora de produção', () => {
    it('não exige senhas e gera uma senha aleatória quando ausente', () => {
      const env = { NODE_ENV: 'development', ADMIN_SEED_PASSWORD: '' };
      expect(validateSeedEnv(env)).toEqual([]);
      expect(resolveSeedPassword(env, 'ADMIN_SEED_PASSWORD', () => 'gerada')).toEqual({
        password: 'gerada',
        generated: true,
      });
      expect(shouldSeedDemoData(env)).toBe(true);
      expect(shouldSeedDemoData({})).toBe(true);
    });

    it('usa a senha definida quando presente', () => {
      expect(resolveSeedPassword({ DEMO_SEED_PASSWORD: 'demo' }, 'DEMO_SEED_PASSWORD')).toEqual({
        password: 'demo',
        generated: false,
      });
    });

    it('gera senhas distintas e longas a cada chamada', () => {
      const a = resolveSeedPassword({}, 'DEMO_SEED_PASSWORD').password;
      const b = resolveSeedPassword({}, 'DEMO_SEED_PASSWORD').password;
      expect(a).not.toBe(b);
      expect(generateSeedPassword().length).toBeGreaterThanOrEqual(MIN_PRODUCTION_SEED_PASSWORD_LENGTH);
    });
  });
});
