import type { ProjectRepository } from '@/domain/ports';
import type { Project } from '@/domain/types';

import type { TalecastDatabase } from '../db';

export interface ProjectRow {
  id: string;
  title: string;
  description: string;
  revision: number;
  created_at: number;
  updated_at: number;
}

export function toProject(row: ProjectRow): Project {
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

  /**
   * 级联删除。command_receipts 一并清理：回执 result_json 含业务数据快照，
   * 与"已删工程的数据不留本地"的隐私口径一致（docs/plan.md P4）；
   * 清理后重放旧命令得到 not_found，属可接受语义。沙盒文件按内容寻址共享，不在此删除。
   */
  async delete(projectId: string): Promise<void> {
    this.db.withTransactionSync(() => {
      this.db.runSync(
        'DELETE FROM command_receipts WHERE result_json LIKE ?',
        `%"${projectId}"%`,
      );
      this.db.runSync(
        `DELETE FROM generation_segments WHERE job_id IN (SELECT id FROM generation_jobs WHERE project_id = ?)`,
        projectId,
      );
      this.db.runSync('DELETE FROM generation_jobs WHERE project_id = ?', projectId);
      this.db.runSync(
        'DELETE FROM assistant_messages WHERE session_id IN (SELECT id FROM assistant_sessions WHERE project_id = ?)',
        projectId,
      );
      this.db.runSync('DELETE FROM assistant_sessions WHERE project_id = ?', projectId);
      this.db.runSync('DELETE FROM reading_state WHERE project_id = ?', projectId);
      this.db.runSync('DELETE FROM chapter_edits WHERE project_id = ?', projectId);
      this.db.runSync('DELETE FROM split_proposals WHERE project_id = ?', projectId);
      this.db.runSync('DELETE FROM bindings WHERE project_id = ?', projectId);
      this.db.runSync('DELETE FROM characters WHERE project_id = ?', projectId);
      this.db.runSync('DELETE FROM chapters WHERE project_id = ?', projectId);
      this.db.runSync('DELETE FROM sources WHERE project_id = ?', projectId);
      this.db.runSync('DELETE FROM projects WHERE id = ?', projectId);
    });
  }
}
