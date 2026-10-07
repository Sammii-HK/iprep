import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { type AudioObjectStore, deleteAudioObjects, isDeletableAudioKey } from '@/lib/audio-store';
import { studyAudioKeys } from '@/lib/native/purge';

function fakeStore(failOn: string[] = []): AudioObjectStore & { calls: string[]; objects: Set<string> } {
  const objects = new Set<string>();
  const calls: string[] = [];
  return {
    calls,
    objects,
    async deleteObject(key) {
      calls.push(key);
      if (failOn.includes(key)) throw Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' });
      objects.delete(key); // deleting a key that is not there succeeds, as on R2
    },
  };
}

describe('R2 deletion boundary (fake store, no network)', () => {
  it('deletes every requested key, once each, and reports completeness', async () => {
    const store = fakeStore();
    ['audio/1-aa.webm', 'audio/2-bb.m4a', 'audio/study/b1.mp3'].forEach((k) => store.objects.add(k));
    const report = await deleteAudioObjects(store, ['audio/1-aa.webm', 'audio/2-bb.m4a', 'audio/study/b1.mp3', 'audio/1-aa.webm']);
    expect(report).toMatchObject({ requested: 3, complete: true, failed: [], refused: [] });
    expect(store.calls).toEqual(['audio/1-aa.webm', 'audio/2-bb.m4a', 'audio/study/b1.mp3']);
    expect(store.objects.size).toBe(0);
  });

  it('never claims completeness after a partial failure, and reports exactly what failed (and a rerun finishes the job)', async () => {
    const flaky = fakeStore(['audio/2-bb.m4a']);
    const first = await deleteAudioObjects(flaky, ['audio/1-aa.webm', 'audio/2-bb.m4a', 'audio/3-cc.webm']);
    expect(first.complete).toBe(false);
    expect(first.deleted).toEqual(['audio/1-aa.webm', 'audio/3-cc.webm']);
    expect(first.failed).toEqual([{ key: 'audio/2-bb.m4a', error: 'AccessDenied' }]);
    const second = await deleteAudioObjects(fakeStore(), ['audio/2-bb.m4a']); // idempotent: safe to repeat
    expect(second.complete).toBe(true);
  });

  it('refuses keys outside the audio prefix, path tricks and shared files, and says so', async () => {
    const store = fakeStore();
    const report = await deleteAudioObjects(store, ['audio/study/manifest.json', '../etc/passwd', 'audio/../secrets', 'images/a.png', 'audio/', '', 'audio//x', 'audio/ok.webm']);
    expect(store.calls).toEqual(['audio/ok.webm']);
    expect(report.refused).toHaveLength(7);
    expect(report.complete).toBe(false);
    expect(isDeletableAudioKey('audio/study/manifest.json')).toBe(false);
    expect(isDeletableAudioKey('audio/study/b1.txt')).toBe(true);
  });

  it('deleting nothing is complete and touches nothing', async () => {
    const store = fakeStore();
    expect(await deleteAudioObjects(store, [])).toMatchObject({ requested: 0, complete: true });
    expect(store.calls).toEqual([]);
  });

  it('a bank\'s generated study episode (audio, transcript, sidecar) is addressed by bank id', () => {
    expect(studyAudioKeys(['b1', 'b2'])).toEqual(['audio/study/b1.mp3', 'audio/study/b1.txt', 'audio/study/b1.json', 'audio/study/b2.mp3', 'audio/study/b2.txt', 'audio/study/b2.json']);
    expect(studyAudioKeys(['b1']).every(isDeletableAudioKey)).toBe(true);
  });
});

describe('boundaries that keep P2 small and safe', () => {
  const root = process.cwd();
  const files = (dir: string): string[] =>
    existsSync(dir) ? readdirSync(dir).flatMap((n) => { const f = join(dir, n); return statSync(f).isDirectory() ? files(f) : /\.(ts|tsx)$/.test(n) ? [f] : []; }) : [];
  const syncCode = [...files(join(root, 'lib', 'sync')), ...files(join(root, 'lib', 'native')), ...files(join(root, 'app', 'api', 'sync')), ...files(join(root, 'app', 'api', 'auth', 'native')), ...files(join(root, 'app', 'api', 'account'))];

  it('native accounts never write audio: no sync or native-auth code touches R2', () => {
    expect(syncCode.length).toBeGreaterThan(10);
    const offenders = syncCode.filter((f) => /@\/lib\/r2|\.\/r2|\.\.\/r2|client-s3|uploadAudio|PutObjectCommand/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.replace(root, ''))).toEqual([]);
  });

  it('P2 never evaluates a synced attempt: no sync code imports the AI layer or the evaluation compat layer, and there is no evaluate route', () => {
    const offenders = syncCode.filter((f) => /ai-optimized|from '\.\.\/ai'|@\/lib\/ai'|attempt-compat|analyzeTranscript|aiEvaluation|chatModelInfo/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.replace(root, ''))).toEqual([]);
    expect(existsSync(join(root, 'app', 'api', 'sync', 'attempts'))).toBe(false);
  });

  it('the only code that deletes R2 objects is the audio store adapter and the existing cleanup script', () => {
    const all = [...files(join(root, 'app')), ...files(join(root, 'lib')), ...files(join(root, 'scripts'))];
    const deleters = all.filter((f) => /DeleteObjectCommand/.test(readFileSync(f, 'utf8'))).map((f) => f.replace(root, '')).sort();
    expect(deleters).toEqual(['/lib/audio-store.ts', '/scripts/cleanup-audio.ts']);
  });
});
