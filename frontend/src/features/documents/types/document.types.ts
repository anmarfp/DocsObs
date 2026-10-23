import { Role } from '@/types/auth';

export type DocumentStatus =
  | 'EXPIRED'
  | 'CRITICAL'
  | 'RENEWAL_IN_PROGRESS'
  | 'REGULAR'
  | 'INDETERMINATE';

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'ARCHIVE'
  | 'UNARCHIVE'
  | 'DELETE'
  | 'RENEW';

export type NotificationMode =
  | 'ALL_ADMINS'
  | 'ONLY_RESPONSIBLE';

export type SyncStatus =
  | 'SYNCED'
  | 'ERROR';

export type { Role };

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role?: Role;
}

export interface DocumentCategory {
  id: string;
  name: string;
  colorHex: string | null;
  description: string | null;
  createdAt?: string;
  documentCount?: number;
}

/** Categoria padrão do sistema, atribuída a documentos sem categoria específica. Nunca é exibida na gestão de categorias (Configurações) nem pode ser excluída. */
export const DEFAULT_CATEGORY_NAME = 'Sem Categoria';

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  issueDate: string;
  expirationDate: string | null;
  attachmentUrl: string | null;
  attachmentFilename: string | null;
  notes: string | null;
  renewedById: string;
  renewedBy?: UserSummary;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  documentId: string | null;
  userId: string | null;
  user?: UserSummary | null;
  userName: string;
  action: AuditAction;
  diffData: Record<string, { old?: unknown; new?: unknown } | unknown>;
  timestamp: string;
}

export interface GCalSyncLog {
  id: string;
  documentId: string;
  gcalEventId: string | null;
  status: SyncStatus;
  lastSyncedAt: string;
  errorMessage: string | null;
}

export interface Document {
  id: string;
  title: string;
  categoryId: string;
  category?: DocumentCategory;
  issuingBody: string | null;
  issueDate: string;
  expirationDate: string | null;
  alertLeadDays: number;
  status: DocumentStatus;
  responsibleName: string | null;
  responsibleEmail: string | null;
  attachmentUrl: string | null;
  attachmentFilename: string | null;
  fileSizeBytes: number | null;
  fileMimeType: string | null;
  notes: string | null;
  isArchived: boolean;
  createdById: string;
  createdBy?: UserSummary;
  createdAt: string;
  updatedAt: string;
  versions?: DocumentVersion[];
  auditLogs?: AuditLog[];
  gcalSyncLogs?: GCalSyncLog[];
  _count?: {
    versions: number;
    auditLogs: number;
  };
}

export interface CompanyConfig {
  id: string;
  notificationMode: NotificationMode;
  updatedAt: string;
  updatedById: string | null;
  updatedBy?: UserSummary | null;
}

export interface DocumentFilterParams {
  search?: string;
  categoryId?: string;
  status?: DocumentStatus | '';
  includeArchived?: boolean;
  page?: number;
  limit?: number;
}

export interface DocumentListResponse {
  documents: Document[];
  total: number;
  page: number;
  limit: number;
}
