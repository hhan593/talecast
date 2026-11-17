import { resolveIdempotent, type Command } from '@/domain/commands';
import type { BindingRepository, CharacterRepository, ReceiptStore } from '@/domain/ports';
import { errorMessage, err, ok, type Result } from '@/domain/result';
import type { BindingRecord, BindingTargetType } from '@/domain/types';

/**
 * 声音绑定（docs/plan.md 4.1.4）：
 * 旁白 / 已确认角色 → 库内音色的显式绑定，幂等回执；绑定修订号参与生成 input_hash。
 * 人工保护：只有用户操作能改绑定（本服务即用户操作入口）；
 * 模型建议（角色抽取）只能创建未确认候选，绝不触碰 confirmed/manual_protected 的绑定。
 */

export interface BindingDeps {
  bindingRepository: BindingRepository;
  characterRepository: CharacterRepository;
  receiptStore: ReceiptStore;
}

export interface BindVoiceCommand extends Omit<Command, 'expectedRevision'> {
  projectId: string;
  targetType: BindingTargetType;
  targetId: string | null;
  voiceId: string;
}

export function createBindingsService(deps: BindingDeps) {
  return {
    async bindVoice(command: BindVoiceCommand): Promise<Result<BindingRecord>> {
      const receipt = await deps.receiptStore.get<BindingRecord>(command.commandId);
      return resolveIdempotent(receipt, async () => {
        if (command.targetType === 'character') {
          if (!command.targetId) return err('invalid', '角色绑定缺少目标角色');
          const character = await deps.characterRepository.get(command.targetId);
          if (!character) return err('not_found', '角色不存在');
          if (!character.confirmed) {
            return err('invalid', '只有人工确认过的角色才能绑定音色');
          }
        }
        try {
          const binding = await deps.bindingRepository.upsert({
            projectId: command.projectId,
            targetType: command.targetType,
            targetId: command.targetId,
            voiceId: command.voiceId,
          });
          await deps.receiptStore.put({
            commandId: command.commandId,
            result: ok(binding),
            createdAt: Date.now(),
          });
          return ok(binding);
        } catch (error) {
          return err('storage', `绑定写入失败：${errorMessage(error)}`);
        }
      });
    },

    async listBindings(projectId: string): Promise<BindingRecord[]> {
      return deps.bindingRepository.list(projectId);
    },
  };
}

export type BindingsService = ReturnType<typeof createBindingsService>;
