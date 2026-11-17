import type { ProjectRepository } from '@/domain/ports';
import type { Project } from '@/domain/types';

export class FakeProjectRepository implements ProjectRepository {
  constructor(public rows: Project[]) {}

  list(): Promise<Project[]> {
    return Promise.resolve([...this.rows]);
  }

  get(id: string): Promise<Project | null> {
    return Promise.resolve(this.rows.find((p) => p.id === id) ?? null);
  }

  create(input: { id: string; title: string; description: string; createdAt: number }): Promise<Project> {
    const project: Project = { ...input, revision: 0, updatedAt: input.createdAt };
    this.rows.push(project);
    return Promise.resolve(project);
  }

  async delete(projectId: string): Promise<void> {
    this.rows = this.rows.filter((p) => p.id !== projectId);
  }
}
