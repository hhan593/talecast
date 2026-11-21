import { useCallback, useEffect, useState } from 'react';

import { parseProsodyJson, type TtsProsody } from '@/domain/jobs';
import { useServices } from '@/container';
import { errorMessage } from '@/domain/result';
import type { BindingRecord, CharacterRecord, VoiceRecord } from '@/domain/types';

export function useCharacters(projectId: string) {
  const services = useServices();
  const [characters, setCharacters] = useState<CharacterRecord[] | null>(null);
  const [bindings, setBindings] = useState<BindingRecord[]>([]);
  const [voices, setVoices] = useState<VoiceRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [characterRows, bindingRows, voiceRows] = await Promise.all([
        services.characters.listCharacters(projectId),
        services.bindings.listBindings(projectId),
        services.voices.listVoices(),
      ]);
      setCharacters(characterRows);
      setBindings(bindingRows);
      setVoices(voiceRows);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [projectId, services]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshVoices = useCallback(
    () =>
      run(async () => {
        const result = await services.voices.refreshVoices();
        if (!result.ok) setError(result.error.message);
        else setError(null);
        await refresh();
      }),
    [refresh, run, services],
  );

  const extract = useCallback(
    () =>
      run(async () => {
        const result = await services.characters.extractCandidates({
          commandId: services.newCommandId(),
          projectId,
        });
        if (!result.ok) setError(result.error.message);
        else setError(null);
        await refresh();
        return result;
      }),
    [projectId, refresh, run, services],
  );

  const confirm = useCallback(
    (characterId: string) =>
      run(async () => {
        await services.characters.confirmCharacter({ commandId: services.newCommandId(), characterId });
        await refresh();
      }),
    [refresh, run, services],
  );

  const rename = useCallback(
    (characterId: string, newName: string) =>
      run(async () => {
        const result = await services.characters.renameCharacter(characterId, newName);
        if (!result.ok) setError(result.error.message);
        await refresh();
      }),
    [refresh, run, services],
  );

  const remove = useCallback(
    (characterId: string) =>
      run(async () => {
        const result = await services.characters.deleteCharacter(characterId);
        if (!result.ok) setError(result.error.message);
        await refresh();
      }),
    [refresh, run, services],
  );

  const bindNarrator = useCallback(
    (voiceId: string) =>
      run(async () => {
        const result = await services.bindings.bindVoice({
          commandId: services.newCommandId(),
          projectId,
          targetType: 'narrator',
          targetId: null,
          voiceId,
        });
        if (!result.ok) setError(result.error.message);
        await refresh();
      }),
    [projectId, refresh, run, services],
  );

  const bindCharacter = useCallback(
    (characterId: string, voiceId: string) =>
      run(async () => {
        const result = await services.bindings.bindVoice({
          commandId: services.newCommandId(),
          projectId,
          targetType: 'character',
          targetId: characterId,
          voiceId,
        });
        if (!result.ok) setError(result.error.message);
        await refresh();
      }),
    [projectId, refresh, run, services],
  );

  const voiceName = useCallback(
    (voiceId: string | null) => voices.find((v) => v.voiceId === voiceId)?.name ?? voiceId,
    [voices],
  );

  const narratorBinding = bindings.find((b) => b.targetType === 'narrator') ?? null;
  const bindingFor = useCallback(
    (characterId: string) => bindings.find((b) => b.targetType === 'character' && b.targetId === characterId) ?? null,
    [bindings],
  );

  /** 合成参数调节（F-2）：同音色重绑 → 绑定 revision+1 → 旧音频缓存自动失效 */
  const updateParams = useCallback(
    (target: 'narrator' | { characterId: string }, patch: TtsProsody) =>
      run(async () => {
        const binding = target === 'narrator' ? narratorBinding : bindingFor(target.characterId);
        if (!binding) {
          setError('请先绑定音色，再调节参数');
          return;
        }
        const merged: TtsProsody = { ...parseProsodyJson(binding.providerParamsJson), ...patch };
        const result = await services.bindings.bindVoice({
          commandId: services.newCommandId(),
          projectId,
          targetType: target === 'narrator' ? 'narrator' : 'character',
          targetId: target === 'narrator' ? null : target.characterId,
          voiceId: binding.voiceId,
          providerParams: merged,
        });
        if (!result.ok) setError(result.error.message);
        await refresh();
      }),
    [bindingFor, narratorBinding, projectId, refresh, run, services],
  );


  return {
    characters,
    bindings,
    voices,
    narratorBinding,
    bindingFor,
    voiceName,
    busy,
    error,
    refresh,
    refreshVoices,
    extract,
    confirm,
    rename,
    remove,
    bindNarrator,
    bindCharacter,
    updateParams,
  };
}
