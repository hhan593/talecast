import type { BookmarkRecord } from '@/domain/types';
import type { BookmarkRepository } from '@/domain/ports';

export class FakeBookmarkRepository implements BookmarkRepository {
  public rows: BookmarkRecord[] = [];

  async list(projectId: string): Promise<BookmarkRecord[]> {
    return this.rows
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({ ...r }));
  }

  async add(record: BookmarkRecord): Promise<'added' | 'exists'> {
    const exists = this.rows.some(
      (r) =>
        r.projectId === record.projectId &&
        r.chapterId === record.chapterId &&
        r.charOffset === record.charOffset,
    );
    if (exists) return 'exists';
    this.rows.push({ ...record });
    return 'added';
  }

  async remove(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
}
