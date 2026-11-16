import { resolveIdempotent, type Command } from '@/domain/commands';
import type { ProjectRepository, ReceiptStore } from '@/domain/ports';
import { err, ok, type Result } from '@/domain/result';
import type { Project } from '@/domain/types';

/**
 * 工程相关用例编排（薄层：每用例一函数，依赖经参数注入，可被 in-memory fake 测试）。
 * 事务、幂等回执的推进只发生在 services 层，UI 不直接触碰仓储。
 */

export interface ProjectsServiceDeps {
  projectRepository: ProjectRepository;
  receiptStore: ReceiptStore;
}

export interface CreateProjectCommand extends Command {
  title: string;
  description?: string;
}

/** 命令 id 同时作为工程主键：重复提交直接返回旧结果，天然幂等（P0 简化，P1 引入显式 id 生成） */
export function createProjectsService(deps: ProjectsServiceDeps) {
  return {
    listProjects(): Promise<Project[]> {
      return deps.projectRepository.list();
    },

    getProject(id: string): Promise<Project | null> {
      return deps.projectRepository.get(id);
    },

    async createTestProject(command: CreateProjectCommand): Promise<Result<Project>> {
      const receipt = await deps.receiptStore.get<Project>(command.commandId);
      return resolveIdempotent(receipt, async () => {
        try {
          const project = await deps.projectRepository.create({
            id: command.commandId,
            title: command.title,
            description: command.description ?? '',
            createdAt: Date.now(),
          });
          await deps.receiptStore.put({
            commandId: command.commandId,
            result: ok(project),
            createdAt: Date.now(),
          });
          return ok(project);
        } catch (error) {
          return err('storage', `创建工程失败：${error instanceof Error ? error.message : String(error)}`);
        }
      });
    },
  };
}

export type ProjectsService = ReturnType<typeof createProjectsService>;
