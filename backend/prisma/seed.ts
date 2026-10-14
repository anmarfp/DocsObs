import { randomBytes } from 'node:crypto';
import { PrismaClient, Role, NotificationMode, DocumentStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { calculateDocumentStatus } from '../src/services/statusService.js';

const SEED_MARKER = 'Gerado pelo seed automatizado de demonstração.';

const FIRST_NAMES = ['Fernanda', 'Ricardo', 'Juliana', 'Marcelo', 'Camila', 'Bruno', 'Patrícia', 'Diego', 'Larissa', 'Rodrigo'];
const LAST_NAMES = ['Alves Rocha', 'Tavares Nunes', 'Prado Barbosa', 'Andrade Costa', 'Ribeiro Duarte', 'Martins Pereira', 'Cardoso Lima', 'Farias Moreira'];

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ---------- Resolução de senhas do seed (DOC-32) ----------
// Nenhuma senha é versionada neste arquivo. Em produção as senhas dos usuários
// fixos são obrigatórias; fora de produção, a ausência gera uma senha aleatória
// por usuário, exibida uma única vez no console.

export const MIN_PRODUCTION_SEED_PASSWORD_LENGTH = 12;
export const REQUIRED_PRODUCTION_SEED_VARS = ['ADMIN_SEED_PASSWORD', 'OPERATIONAL_SEED_PASSWORD'] as const;

export type SeedEnv = Record<string, string | undefined>;

export interface ResolvedSeedPassword {
  password: string;
  generated: boolean;
}

export class SeedConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedConfigError';
  }
}

export function isProductionSeed(env: SeedEnv): boolean {
  return env.NODE_ENV === 'production';
}

function readPassword(env: SeedEnv, name: string): string | undefined {
  const value = env[name];
  return value && value.trim() !== '' ? value : undefined;
}

export function generateSeedPassword(): string {
  return randomBytes(18).toString('base64url');
}

/**
 * Valida a configuração do seed. Retorna a lista de problemas (vazia quando a
 * configuração é válida). Fora de produção nenhuma senha é obrigatória.
 */
export function validateSeedEnv(env: SeedEnv): string[] {
  if (!isProductionSeed(env)) return [];
  const problems: string[] = [];
  for (const name of REQUIRED_PRODUCTION_SEED_VARS) {
    const value = readPassword(env, name);
    if (!value) {
      problems.push(`${name} não definida`);
    } else if (value.length < MIN_PRODUCTION_SEED_PASSWORD_LENGTH) {
      problems.push(`${name} deve ter ao menos ${MIN_PRODUCTION_SEED_PASSWORD_LENGTH} caracteres`);
    }
  }
  return problems;
}

export function assertSeedEnv(env: SeedEnv): void {
  const problems = validateSeedEnv(env);
  if (problems.length > 0) {
    throw new SeedConfigError(
      `Seed abortado em NODE_ENV=production: ${problems.join('; ')}. ` +
        `Defina ${REQUIRED_PRODUCTION_SEED_VARS.join(' e ')} (mínimo de ${MIN_PRODUCTION_SEED_PASSWORD_LENGTH} caracteres) ` +
        'ou desabilite o seed com RUN_SEED=false.'
    );
  }
}

/**
 * Resolve a senha de um usuário do seed: usa a variável de ambiente quando
 * definida; fora de produção gera uma senha aleatória; em produção falha.
 */
export function resolveSeedPassword(
  env: SeedEnv,
  name: string,
  generate: () => string = generateSeedPassword
): ResolvedSeedPassword {
  const value = readPassword(env, name);
  if (value) return { password: value, generated: false };
  if (isProductionSeed(env)) {
    throw new SeedConfigError(`Seed abortado em NODE_ENV=production: ${name} não definida.`);
  }
  return { password: generate(), generated: true };
}

/** Usuários e documentos de demonstração nunca são criados em produção. */
export function shouldSeedDemoData(env: SeedEnv): boolean {
  return !isProductionSeed(env);
}

function logPassword(email: string, resolved: ResolvedSeedPassword, envName: string): void {
  if (resolved.generated) {
    console.log(`   🔑 Senha gerada para ${email} (exibida apenas agora; defina ${envName} para fixá-la): ${resolved.password}`);
  } else {
    console.log(`   🔑 Senha de ${email} definida por ${envName}.`);
  }
}

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

async function main(prisma: PrismaClient, env: SeedEnv) {
  console.log('🌱 Iniciando o seed do banco de dados DocsObs...');

  // 1. Configuração Padrão da Empresa (Single-Tenant no MVP)
  const existingConfig = await prisma.companyConfig.findFirst();
  if (!existingConfig) {
    await prisma.companyConfig.create({
      data: {
        notificationMode: NotificationMode.ALL_ADMINS,
      },
    });
    console.log('✅ Configuração padrão da empresa criada (Modo: Notificar Todos os Administradores).');
  }

  // 2. Usuário Administrador Padrão
  const adminEmail = 'admin@docsobs.com.br';
  let adminUser = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!adminUser) {
    const adminPassword = resolveSeedPassword(env, 'ADMIN_SEED_PASSWORD');
    const adminPasswordHash = await bcrypt.hash(adminPassword.password, 10);
    adminUser = await prisma.user.create({
      data: {
        name: 'Administrador do Sistema',
        email: adminEmail,
        passwordHash: adminPasswordHash,
        role: Role.ADMIN,
        isActive: true,
      },
    });
    console.log(`✅ Usuário Administrador criado: ${adminEmail}`);
    logPassword(adminEmail, adminPassword, 'ADMIN_SEED_PASSWORD');
  } else {
    console.log(`ℹ️ Usuário Administrador já existe (${adminEmail}) — senha preservada.`);
  }

  // 3. Usuário Operacional de Demonstração
  const opEmail = 'operacional@docsobs.com.br';
  const existingOp = await prisma.user.findUnique({
    where: { email: opEmail },
  });

  if (!existingOp) {
    const opPassword = resolveSeedPassword(env, 'OPERATIONAL_SEED_PASSWORD');
    const opPasswordHash = await bcrypt.hash(opPassword.password, 10);
    await prisma.user.create({
      data: {
        name: 'Analista Operacional',
        email: opEmail,
        passwordHash: opPasswordHash,
        role: Role.OPERATIONAL,
        isActive: true,
      },
    });
    console.log(`✅ Usuário Operacional criado: ${opEmail}`);
    logPassword(opEmail, opPassword, 'OPERATIONAL_SEED_PASSWORD');
  } else {
    console.log(`ℹ️ Usuário Operacional já existe (${opEmail}) — senha preservada.`);
  }

  // 4. Categorias Padrão de Documentos
  const defaultCategories = [
    { name: 'Sem Categoria', colorHex: '#94a3b8', description: 'Categoria padrão atribuída a documentos sem uma categoria específica definida.' },
    { name: 'Fiscal', colorHex: '#3b82f6', description: 'Certidões negativas, guias de impostos, cadastros fiscais e declarações' },
    { name: 'Trabalhista & Previdenciário', colorHex: '#10b981', description: 'FGTS, CNDT, PCMSO, PGR, PPRA e obrigações trabalhistas' },
    { name: 'Licenças e Alvarás', colorHex: '#f59e0b', description: 'Alvarás de funcionamento, vigilância sanitária, corpo de bombeiros e meio ambiente' },
    { name: 'Contratos e Parcerias', colorHex: '#8b5cf6', description: 'Contratos de prestação de serviços, locações, fornecedores e termos aditivos' },
    { name: 'Seguros e Apólices', colorHex: '#ec4899', description: 'Seguro predial, de responsabilidade civil, vida em grupo e garantias' },
    { name: 'Frota e Veículos', colorHex: '#06b6d4', description: 'CRLV, laudos veiculares, tacógrafos e seguros de frota' },
    { name: 'Societário e Jurídico', colorHex: '#6366f1', description: 'Contrato social, procurações, atas de assembleia e registros em junta comercial' },
  ];

  const categories = [];
  for (const cat of defaultCategories) {
    const category = await prisma.documentCategory.upsert({
      where: { name: cat.name },
      update: {},
      create: cat,
    });
    categories.push(category);
  }
  console.log(`✅ ${defaultCategories.length} categorias padrão sincronizadas.`);

  // 5. Usuários Aleatórios de Demonstração (somente fora de produção)
  if (!shouldSeedDemoData(env)) {
    console.log('ℹ️ NODE_ENV=production — usuários e documentos de demonstração não são criados.');
    console.log('✨ Seed finalizado com sucesso!');
    return;
  }

  const existingSeedDoc = await prisma.document.findFirst({ where: { notes: SEED_MARKER } });

  if (!existingSeedDoc) {
    const firstNames = shuffle(FIRST_NAMES).slice(0, 5);
    const lastNames = shuffle(LAST_NAMES).slice(0, 5);
    const randomUsers = [];

    for (let i = 0; i < 5; i++) {
      const name = `${firstNames[i]} ${lastNames[i]}`;
      const lastNameParts = lastNames[i].split(' ');
      const emailLocal = `${firstNames[i]}.${lastNameParts[lastNameParts.length - 1]}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
      const email = `${emailLocal}@docsobs.com.br`;
      // No máximo 1 dos 5 é ADMIN, mantendo o perfil Operacional como maioria (RN-009).
      const role = i === 0 ? Role.ADMIN : Role.OPERATIONAL;
      const existingDemoUser = await prisma.user.findUnique({ where: { email } });
      if (existingDemoUser) {
        randomUsers.push(existingDemoUser);
        console.log(`ℹ️ Usuário aleatório já existe: ${email} — senha preservada.`);
        continue;
      }

      // DEMO_SEED_PASSWORD (se definida) vale para todos; senão, senha aleatória por usuário.
      const demoPassword = resolveSeedPassword(env, 'DEMO_SEED_PASSWORD');
      const passwordHash = await bcrypt.hash(demoPassword.password, 10);
      const user = await prisma.user.create({
        data: { name, email, passwordHash, role, isActive: true },
      });
      randomUsers.push(user);
      console.log(`✅ Usuário aleatório criado: ${email} (${role})`);
      logPassword(email, demoPassword, 'DEMO_SEED_PASSWORD');
    }

    // 6. Documentos de Demonstração com Status Variados (RN-001)
    const allUsers = [adminUser, ...randomUsers];
    const documentSeeds: Array<{
      title: string;
      categoryName: string;
      issuingBody: string;
      expirationDate: Date | null;
      alertLeadDays?: number;
      forceRenewal?: boolean;
      responsibleName?: string;
      responsibleEmail?: string;
    }> = [
      // 🔴 EXPIRED
      { title: 'Certidão Negativa de Débitos Federais (CND)', categoryName: 'Fiscal', issuingBody: 'Receita Federal do Brasil', expirationDate: daysFromNow(-15) },
      { title: 'CNDT - Certidão Negativa de Débitos Trabalhistas', categoryName: 'Trabalhista & Previdenciário', issuingBody: 'Tribunal Superior do Trabalho', expirationDate: daysFromNow(-3) },
      // 🟡 CRITICAL
      { title: 'Alvará de Funcionamento', categoryName: 'Licenças e Alvarás', issuingBody: 'Prefeitura Municipal', expirationDate: daysFromNow(10) },
      { title: 'Apólice de Seguro Predial', categoryName: 'Seguros e Apólices', issuingBody: 'Porto Seguro S.A.', expirationDate: daysFromNow(20) },
      // 🔵 RENEWAL_IN_PROGRESS
      { title: 'Licença do Corpo de Bombeiros (AVCB)', categoryName: 'Licenças e Alvarás', issuingBody: 'Corpo de Bombeiros', expirationDate: daysFromNow(7), forceRenewal: true },
      { title: 'CRLV - Veículo Placa ABC-1D23', categoryName: 'Frota e Veículos', issuingBody: 'DETRAN', expirationDate: daysFromNow(15), forceRenewal: true },
      // 🟢 REGULAR
      { title: 'Contrato de Locação - Sede Administrativa', categoryName: 'Contratos e Parcerias', issuingBody: 'Imobiliária Central Ltda.', expirationDate: daysFromNow(120) },
      { title: 'PCMSO - Programa de Controle Médico de Saúde Ocupacional', categoryName: 'Trabalhista & Previdenciário', issuingBody: 'Clínica Ocupacional Vida', expirationDate: daysFromNow(200) },
      // ⚪ INDETERMINATE
      { title: 'Contrato Social Consolidado', categoryName: 'Societário e Jurídico', issuingBody: 'Junta Comercial', expirationDate: null },
      { title: 'Procuração Geral de Representação', categoryName: 'Societário e Jurídico', issuingBody: 'Cartório do 1º Ofício', expirationDate: null },
    ];

    for (const seedDoc of documentSeeds) {
      const category = categories.find((c) => c.name === seedDoc.categoryName)!;
      const creator = pickRandom(allUsers);
      const alertLeadDays = seedDoc.alertLeadDays ?? 30;
      const status = seedDoc.forceRenewal
        ? DocumentStatus.RENEWAL_IN_PROGRESS
        : calculateDocumentStatus(seedDoc.expirationDate, alertLeadDays, false);

      await prisma.document.create({
        data: {
          title: seedDoc.title,
          categoryId: category.id,
          issuingBody: seedDoc.issuingBody,
          issueDate: daysFromNow(-365),
          expirationDate: seedDoc.expirationDate,
          alertLeadDays,
          status,
          responsibleName: creator.name,
          responsibleEmail: creator.email,
          notes: SEED_MARKER,
          createdById: creator.id,
        },
      });
    }
    console.log(`✅ ${documentSeeds.length} documentos de demonstração criados com status variados.`);
  } else {
    console.log('ℹ️ Documentos de demonstração já existentes — pulando geração de usuários e documentos aleatórios.');
  }

  console.log('✨ Seed finalizado com sucesso!');
}

async function run(): Promise<void> {
  dotenv.config();
  const env: SeedEnv = process.env;

  try {
    // Falha antes de tocar no banco quando a configuração de produção está incompleta.
    assertSeedEnv(env);
  } catch (e) {
    console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    await main(prisma, env);
  } catch (e) {
    console.error('❌ Erro durante o seed do banco de dados:', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Executa apenas quando invocado diretamente (tsx/node), não quando importado pelos testes.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  void run();
}
