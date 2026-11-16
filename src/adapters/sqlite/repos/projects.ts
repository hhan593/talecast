import type { ProjectRepository } from '@/domain/ports';
import type { Project } from '@/domain/types';

import type { TalecastDatabase } from '../db';

interface ProjectRow {
  id: string;
  title: string;
  description: string;
  revision: number;
  created_at: number;
  updated_at: number;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** ProjectRepository 的 SQLite 实现（实现在 adapters，接口在 domain/ports） */
export class SqliteProjectRepository implements ProjectRepository {
  constructor(private readonly db: TalecastDatabase) {}

  list(): Promise<Project[]> {
    const rows = this.db.getAllSync<ProjectRow>(
      'SELECT * FROM projects ORDER BY updated_at DESC',
    );
    return Promise.resolve(rows.map(toProject));
  }

  get(id: string): Promise<Project | null> {
    const row = this.db.getFirstSync<ProjectRow>(
      'SELECT * FROM projects WHERE id = ?',
      id,
    );
    return Promise.resolve(row ? toProject(row) : null);
  }

  create(input: { id: string; title: string; description: string; createdAt: number }): Promise<Project> {
    this.db.runSync(
      'INSERT INTO projects (id, title, description, revision, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
      input.id,
      input.title,
      input.description,
      input.createdAt,
      input.createdAt,
    );
    return Promise.resolve({
      id: input.id,
      title: input.title,
      description: input.description,
      revision: 0,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  }
}
