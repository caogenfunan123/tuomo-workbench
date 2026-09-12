export type DomainErrorKind =
  | 'validation'
  | 'conflict'
  | 'notFound'
  | 'unauthorized'
  | 'rateLimited'
  | 'network'
  | 'unsupported'
  | 'cancelled'
  | 'storage'
  | 'security';

export class DomainError extends Error {
  readonly kind: DomainErrorKind;
  readonly details: Record<string, unknown>;

  constructor(kind: DomainErrorKind, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainError';
    this.kind = kind;
    this.details = details;
  }
}

export function assertDomain(condition: unknown, message: string, kind: DomainErrorKind = 'validation'): asserts condition {
  if (!condition) throw new DomainError(kind, message);
}
