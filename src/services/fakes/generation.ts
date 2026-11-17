import { EDGE_TTS_PROVIDER } from '@/domain/contracts';
import { utf8Bytes } from '@/domain/hash';
import type { JobStatus, SegmentStatus } from '@/domain/jobs';
import type {
  BindingRecord,
  BindingTargetType,
  CharacterRecord,
  GenerationJobRecord,
  GenerationSegmentRecord,
  VoiceRecord,
} from '@/domain/types';
import type {
  AudioFileStore,
  BindingRepository,
  CharacterRepository,
  GenerationStore,
  TtsGateway,
} from '@/domain/ports';

export class FakeTtsGateway implements TtsGateway {
  /** 合成请求计数：验证"重试请求数 = 缺失段数" */
  public synthCalls: string[] = [];
  /** 包含这些关键字的文本合成会失败（模拟单段失败） */
  public failTextIncludes: string[] = [];
  /** 按请求序号（0 起）注入失败，与分段结果解耦 */
  public failCallIndexes: number[] = [];
  /** 每次合成的模拟延迟（毫秒），供取消时序测试 */
  public synthDelayMs = 0;

  async listVoices() {
    return [
      { provider: EDGE_TTS_PROVIDER, voiceId: 'zh-CN-XiaoxiaoNeural', name: '晓晓', description: '女' },
      { provider: EDGE_TTS_PROVIDER, voiceId: 'zh-CN-YunxiNeural', name: '云希', description: '男' },
    ];
  }

  async synthesize(input: { text: string; voiceId: string }): Promise<Uint8Array> {
    const index = this.synthCalls.length;
    if (this.synthDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.synthDelayMs));
    }
    this.synthCalls.push(`${input.voiceId}:${input.text}`);
    if (this.failCallIndexes.includes(index) || this.failTextIncludes.some((marker) => input.text.includes(marker))) {
      throw new Error('模拟合成失败');
    }
    // 确定性伪音频载荷
    return new TextEncoder().encode(`audio(${input.voiceId}):${input.text}`);
  }
}

export class FakeAudioFileStore implements AudioFileStore {
  public files = new Map<string, string>();

  pathFor(textHash: string): string {
    return `fake://audio/${textHash}.mp3`;
  }

  async exists(textHash: string): Promise<boolean> {
    return this.files.has(textHash);
  }

  async write(textHash: string, _bytes: Uint8Array): Promise<string> {
    this.files.set(textHash, this.pathFor(textHash));
    return this.pathFor(textHash);
  }
}

export class FakeBindingRepository implements BindingRepository {
  public rows: BindingRecord[] = [];

  async getForTarget(projectId: string, targetType: BindingTargetType, targetId: string | null): Promise<BindingRecord | null> {
    return (
      this.rows.find((r) => r.projectId === projectId && r.targetType === targetType && r.targetId === (targetId ?? null)) ?? null
    );
  }

  async list(projectId: string): Promise<BindingRecord[]> {
    return this.rows.filter((r) => r.projectId === projectId);
  }

  async upsert(record: Omit<BindingRecord, 'id' | 'revision' | 'updatedAt'>): Promise<BindingRecord> {
    const existing = this.rows.find(
      (r) =>
        r.projectId === record.projectId && r.targetType === record.targetType && r.targetId === (record.targetId ?? null),
    );
    if (existing) {
      existing.voiceId = record.voiceId;
      existing.revision += 1;
      existing.updatedAt = Date.now();
      return { ...existing };
    }
    const created: BindingRecord = {
      id: `bind-${this.rows.length}`,
      projectId: record.projectId,
      targetType: record.targetType,
      targetId: record.targetId ?? null,
      voiceId: record.voiceId,
      revision: 1,
      updatedAt: Date.now(),
    };
    this.rows.push(created);
    return { ...created };
  }
}

export class FakeCharacterRepository implements CharacterRepository {
  public rows: CharacterRecord[] = [];

  async list(projectId: string): Promise<CharacterRecord[]> {
    return this.rows.filter((r) => r.projectId === projectId);
  }

  async get(id: string): Promise<CharacterRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async insert(record: CharacterRecord): Promise<void> {
    this.rows.push({ ...record });
  }

  async update(
    id: string,
    patch: Partial<Pick<CharacterRecord, 'name' | 'aliasesJson' | 'profileJson' | 'confirmed' | 'manualProtected'>>,
  ): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error('不存在');
    Object.assign(row, patch, { updatedAt: Date.now() });
  }

  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
}

export class FakeGenerationStore implements GenerationStore {
  public jobs = new Map<string, GenerationJobRecord>();
  public segments = new Map<string, GenerationSegmentRecord[]>();

  async createJob(job: GenerationJobRecord, segments: Array<GenerationSegmentRecord>): Promise<void> {
    this.jobs.set(job.id, { ...job });
    this.segments.set(job.id, segments.map((s) => ({ ...s })));
  }

  async getJob(id: string): Promise<GenerationJobRecord | null> {
    return this.jobs.get(id) ?? null;
  }

  async findByInputHash(projectId: string, inputHash: string): Promise<GenerationJobRecord | null> {
    const list = [...this.jobs.values()]
      .filter((j) => j.projectId === projectId && j.inputHash === inputHash)
      .sort((a, b) => b.createdAt - a.createdAt);
    return list[0] ?? null;
  }

  async getActiveJobByChapter(projectId: string, chapterId: string): Promise<GenerationJobRecord | null> {
    return (
      [...this.jobs.values()].find(
        (j) => j.projectId === projectId && j.chapterId === chapterId && (j.status === 'pending' || j.status === 'running'),
      ) ?? null
    );
  }

  async listJobsByChapter(projectId: string, chapterId: string): Promise<GenerationJobRecord[]> {
    return [...this.jobs.values()].filter((j) => j.projectId === projectId && j.chapterId === chapterId);
  }

  async updateJob(
    id: string,
    patch: Partial<Pick<GenerationJobRecord, 'status' | 'progress' | 'error'>>,
  ): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) throw new Error('job 不存在');
    Object.assign(job, patch, { updatedAt: Date.now() });
  }

  async listSegments(jobId: string): Promise<GenerationSegmentRecord[]> {
    return [...(this.segments.get(jobId) ?? [])];
  }

  async updateSegment(
    id: string,
    patch: Partial<Pick<GenerationSegmentRecord, 'status' | 'filePath' | 'error'>>,
  ): Promise<void> {
    for (const list of this.segments.values()) {
      const segment = list.find((s) => s.id === id);
      if (segment) {
        Object.assign(segment, patch, { updatedAt: Date.now() });
        return;
      }
    }
    throw new Error('segment 不存在');
  }

  async markInterruptedJobsFailed(): Promise<number> {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'pending' || job.status === 'running') {
        job.status = 'failed';
        job.error = '应用重启中断';
        count += 1;
      }
    }
    return count;
  }
}
