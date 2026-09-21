export class DesktopJobRegistry {
  private readonly jobs = new Map<string, AbortController>();

  create(jobId: string): AbortController {
    this.cancel(jobId);
    const controller = new AbortController();
    this.jobs.set(jobId, controller);
    return controller;
  }

  abort(jobId: string): boolean {
    const existing = this.jobs.get(jobId);
    if (!existing) return false;
    existing.abort();
    return true;
  }

  abortAll(): string[] {
    const ids = [...this.jobs.keys()];
    for (const id of ids) this.abort(id);
    return ids;
  }

  isAborted(jobId: string): boolean {
    return this.jobs.get(jobId)?.signal.aborted === true;
  }

  cancel(jobId: string): void {
    const existing = this.jobs.get(jobId);
    if (existing && !existing.signal.aborted) existing.abort();
    this.jobs.delete(jobId);
  }
}

export const desktopJobs = new DesktopJobRegistry();
