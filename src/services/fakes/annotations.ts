import type { AnnotationRepository } from '@/domain/ports';
import type { AnnotationRecord } from '@/domain/annotations';

export class FakeAnnotationRepository implements AnnotationRepository {
  public records: AnnotationRecord[] = [];

  async list(projectId: string): Promise<AnnotationRecord[]> {
    return this.records
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => a.startOffset - b.startOffset);
  }

  async insert(record: AnnotationRecord): Promise<void> {
    this.records.push({ ...record });
  }

  async update(id: string, patch: { note?: string; kind?: 'underline' }): Promise<void> {
    const record = this.records.find((r) => r.id === id);
    if (!record) throw new Error(`标注不存在 ${id}`);
    Object.assign(record, patch, { updatedAt: Date.now() });
  }

  async remove(id: string): Promise<void> {
    this.records = this.records.filter((r) => r.id !== id);
  }
}
