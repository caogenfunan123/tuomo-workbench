import { DomainError } from '../domain/errors.ts';
import type { AuditStore } from './ports.ts';

export type CreatedResource = { kind: string; id: string; rollback: () => Promise<void> };
export type WizardStep = { id: string; run: () => Promise<CreatedResource | undefined> };
export type WizardResult = { ok: boolean; completed: string[]; rolledBack: string[]; leftBehind: CreatedResource[]; error?: unknown };

export class SiteWizardUseCase {
  private readonly audit?: AuditStore;
  constructor(audit?: AuditStore) { this.audit = audit; }

  async execute(steps: WizardStep[], options: { signal?: AbortSignal } = {}): Promise<WizardResult> {
    const created: CreatedResource[] = [];
    const completed: string[] = [];
    try {
      for (const step of steps) {
        if (options.signal?.aborted) throw new DomainError('cancelled', 'Site wizard cancelled');
        const resource = await step.run();
        if (resource) created.push(resource);
        completed.push(step.id);
        await this.audit?.append({ action: 'site-wizard.step', subject: step.id, details: { resource: resource?.kind } });
      }
      await this.audit?.append({ action: 'site-wizard.complete', details: { steps: steps.length } });
      return { ok: true, completed, rolledBack: [], leftBehind: [] };
    } catch (error) {
      const rolledBack: string[] = []; const leftBehind: CreatedResource[] = [];
      for (const resource of [...created].reverse()) { try { await resource.rollback(); rolledBack.push(resource.id); } catch { leftBehind.push(resource); } }
      await this.audit?.append({ action: 'site-wizard.rollback', details: { rolledBack, leftBehind: leftBehind.map((resource) => resource.id) } });
      return { ok: false, completed, rolledBack, leftBehind, error };
    }
  }
}
