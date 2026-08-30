/**
 * Backward-compatibility gate.
 *
 *   node scripts/baseline.mjs           compare against the recorded baseline
 *   node scripts/baseline.mjs --write   record a new baseline
 *
 * V6 extends the scene model with graphic objects, and the single biggest risk
 * in doing that is silently changing what an existing project means. This
 * fingerprints the surfaces that would show such a change first — the JSON
 * schema and the timeline — for every Reference Reel and every shipped
 * template, and fails loudly if any of them moves.
 *
 * What it checks, per reel:
 *
 *  - **Round-trip settles.** `serialiseProject` → `parseFlarentScript` →
 *    `serialiseProject` and then round again: the second lap must change
 *    nothing. Note the first lap legitimately can — the importer snaps
 *    durations onto the frame grid, so a reel authored at 0.85s (25.5 frames)
 *    reads back as 0.867s. It renders identically either way, and it settles
 *    after one pass. Idempotence, not byte-identity, is the invariant, and it
 *    is what breaks the moment a field is written but not read (or vice versa).
 *    Which scenes got snapped is recorded per reel under `durationsSnapped`.
 *  - **Schema fingerprint.** A hash of the serialised JSON, plus the sorted set
 *    of keys actually used at document, scene and element level. A hash alone
 *    says "something changed"; the key sets say *what*, which is the difference
 *    between a two-minute fix and an afternoon.
 *  - **Timeline.** Scene count, per-scene frames and the total, so a change to
 *    duration rounding cannot pass unnoticed.
 *  - **Import warnings.** Parsing a reel the engine itself produced must raise
 *    no errors, and its warnings are recorded so new ones are visible.
 *
 * What it deliberately does not check: rendered pixels. `planScene` needs
 * `measureText` and therefore a DOM, and the renderer has a known noise floor
 * (~1.5–2px of centroid drift between two runs of identical code), so a pixel
 * baseline would produce false alarms. Layout regressions are caught by
 * rendering and diffing against a same-code two-run baseline instead — see the
 * gotchas in SESSION_HANDOFF.md.
 *
 * Adding an *optional* field to the schema should leave every line of this
 * output unchanged. If it does not, the field is not optional in practice.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This file is ESM; the bundle esbuild produces is CommonJS.
const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'test', 'baseline.json');
const write = process.argv.includes('--write');

/* The engine is TypeScript and ESM-with-JSX; bundle the bits we need into one
   CommonJS file esbuild can hand straight to node. React comes along for the
   ride because `presets.ts` pulls in the scene types, but nothing renders. */
const work = mkdtempSync(path.join(tmpdir(), 'flarent-baseline-'));
const entry = path.join(work, 'entry.ts');

writeFileSync(
  entry,
  `
import { PRESETS } from ${JSON.stringify(path.join(ROOT, 'src/data/presets'))};
import { serialiseProject, parseFlarentScript } from ${JSON.stringify(path.join(ROOT, 'src/utils/importScript'))};
import { buildTimeline, totalFrames, CANVAS } from ${JSON.stringify(path.join(ROOT, 'src/utils/timing'))};

const keysOf = (obj: any, into: Set<string>) => {
  for (const k of Object.keys(obj ?? {})) into.add(k);
};

/**
 * Scene and element ids come from \`makeSceneId()\`, which mints them from
 * Date.now(), so they differ on every build and would make the schema hash
 * useless. Replace them with their position: what we are fingerprinting is the
 * *shape* of the document, not the identity of a particular run's objects.
 */
const normalise = (doc: any) => {
  const copy = JSON.parse(JSON.stringify(doc));
  (copy.scenes ?? []).forEach((s: any, i: number) => {
    if ('id' in s) s.id = 'scene-' + i;
    (s.elements ?? []).forEach((e: any, j: number) => {
      if ('id' in e) e.id = 'el-' + i + '-' + j;
    });
  });
  return JSON.stringify(copy, null, 2);
};

const fingerprint = (label: string, scenes: any[], title: string | null) => {
  const json = serialiseProject(scenes, title, {}, null, 'portrait');
  const parsed = parseFlarentScript(json);
  if (!parsed.ok) {
    return { label, error: 'engine output failed its own parser',
             issues: parsed.issues.map((i: any) => i.path + ': ' + i.message) };
  }
  const again = serialiseProject(parsed.project.scenes, parsed.project.title,
                                 parsed.project.fields, parsed.project.overlay,
                                 parsed.project.format);

  /**
   * A second lap. The importer snaps every duration onto the frame grid
   * (0.85s at 30fps is 25.5 frames, which becomes 26 and reads back as
   * 0.867s), so the *first* round trip legitimately rewrites some numbers and
   * cannot be byte-identical. What must hold is that it settles: once the
   * durations are frame-aligned, every further trip is a no-op. Idempotence is
   * the real invariant, and it is the one that catches a schema field being
   * written but not read.
   */
  const parsedAgain = parseFlarentScript(again);
  const third = parsedAgain.ok
    ? serialiseProject(parsedAgain.project.scenes, parsedAgain.project.title,
                       parsedAgain.project.fields, parsedAgain.project.overlay,
                       parsedAgain.project.format)
    : null;

  const doc = JSON.parse(json);
  const docKeys = new Set<string>(); keysOf(doc, docKeys);
  const sceneKeys = new Set<string>(); const elementKeys = new Set<string>();
  for (const s of doc.scenes ?? []) {
    keysOf(s, sceneKeys);
    for (const e of s.elements ?? []) keysOf(e, elementKeys);
  }

  const timeline = buildTimeline(scenes, CANVAS.fps);
  return {
    label,
    scenes: scenes.length,
    totalFrames: totalFrames(scenes, CANVAS.fps),
    frames: timeline.map((t: any) => t.durationInFrames),
    /** True only for reels whose durations already sit on the frame grid. */
    roundTripStable: again === json,
    /** Must always be true: the second trip changes nothing. */
    roundTripIdempotent: third !== null && third === again,
    /** Which scenes the frame grid moved, and by how much. Recorded, not failed. */
    durationsSnapped: scenes
      .map((s: any, i: number) => ({
        i,
        from: s.duration,
        to: parsed.project.scenes[i]?.duration,
      }))
      .filter((d: any) => d.to !== undefined && Math.abs(d.to - d.from) > 1e-9),
    schemaHash: null as string | null,   // filled in on the node side
    json: normalise(doc),
    docKeys: [...docKeys].sort(),
    sceneKeys: [...sceneKeys].sort(),
    elementKeys: [...elementKeys].sort(),
    importErrors: parsed.issues.filter((i: any) => i.severity === 'error').length,
    importWarnings: parsed.issues
      .filter((i: any) => i.severity === 'warning')
      .map((i: any) => (i.path ? i.path + ': ' : '') + i.message)
      .sort(),
  };
};

export const collect = () => {
  const reels = PRESETS.map((p: any) => fingerprint('reel:' + p.id, p.build(), p.label));
  return reels;
};

/**
 * Templates get the same treatment as reels, not just a parse check. They are
 * the documents that actually exercise \`image\`, \`overlay\`, \`visualNote\` and
 * \`scale\` — no Reference Reel uses any of them — so without serialising them
 * back out, those fields would have no regression cover at all.
 */
export const parseFile = (source: string, label: string) => {
  const r = parseFlarentScript(source);
  if (!r.ok) {
    return { label, ok: false,
             errors: r.issues.filter((i: any) => i.severity === 'error')
                              .map((i: any) => (i.path ? i.path + ': ' : '') + i.message).sort() };
  }

  const out = serialiseProject(r.project.scenes, r.project.title, r.project.fields,
                               r.project.overlay, r.project.format);
  const back = parseFlarentScript(out);
  const out2 = back.ok
    ? serialiseProject(back.project.scenes, back.project.title, back.project.fields,
                       back.project.overlay, back.project.format)
    : null;

  const doc = JSON.parse(out);
  const docKeys = new Set<string>(); keysOf(doc, docKeys);
  const sceneKeys = new Set<string>(); const elementKeys = new Set<string>();
  for (const s of doc.scenes ?? []) {
    keysOf(s, sceneKeys);
    for (const e of s.elements ?? []) keysOf(e, elementKeys);
  }

  return {
    label, ok: true,
    scenes: r.project.scenes.length,
    roundTripIdempotent: out2 !== null && out2 === out,
    json: normalise(doc),
    docKeys: [...docKeys].sort(),
    sceneKeys: [...sceneKeys].sort(),
    elementKeys: [...elementKeys].sort(),
    format: r.project.format,
    palette: r.project.palette,
    title: r.project.title,
    totalFrames: r.project.durationInFrames,
    warnings: r.issues.filter((i: any) => i.severity === 'warning')
                      .map((i: any) => (i.path ? i.path + ': ' : '') + i.message).sort(),
  };
};
`,
  'utf8',
);

const bundle = path.join(work, 'entry.cjs');
execFileSync(
  path.join(ROOT, 'node_modules/.bin/esbuild'),
  [entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${bundle}`,
   '--log-level=error'],
  { stdio: 'inherit', cwd: ROOT },
);

const mod = require(bundle);
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const reels = mod.collect().map((r) => {
  if (r.error) return r;
  const { json, ...rest } = r;
  return { ...rest, schemaHash: sha(json) };
});

/* The shipped templates are the other half of the contract: they are the
   documents users are told to copy, so they must keep parsing identically. */
const templates = ['script-template.json', 'script-full-reference.json',
                   'script-v3-composition.json']
  .filter((f) => existsSync(path.join(ROOT, 'templates', f)))
  .map((f) => mod.parseFile(readFileSync(path.join(ROOT, 'templates', f), 'utf8'),
                            'template:' + f))
  .map((t) => {
    if (!t.ok) return t;
    const { json, ...rest } = t;
    return { ...rest, schemaHash: sha(json) };
  });

rmSync(work, { recursive: true, force: true });

const current = { reels, templates };

if (write) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  console.log(`baseline written: ${reels.length} reels, ${templates.length} templates`);
  const bad = reels.filter((r) => r.error || r.roundTripIdempotent === false);
  if (bad.length) {
    console.error('\nrecorded, but these are already broken:');
    for (const b of bad) console.error('  ' + b.label);
    process.exit(1);
  }
  const snapped = reels.filter((r) => r.durationsSnapped?.length);
  if (snapped.length) {
    console.log(
      `note: ${snapped.length} reel(s) have durations off the frame grid; the ` +
      'first import snaps them (renders identically, JSON differs):',
    );
    for (const r of snapped) {
      console.log(`  ${r.label} — ${r.durationsSnapped.length} scene(s), e.g. ` +
        `${r.durationsSnapped[0].from}s → ${r.durationsSnapped[0].to}s`);
    }
  }
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error('No baseline recorded. Run: node scripts/baseline.mjs --write');
  process.exit(2);
}

const previous = JSON.parse(readFileSync(BASELINE, 'utf8'));
const failures = [];

const compare = (was, now, label) => {
  const keys = new Set([...Object.keys(was ?? {}), ...Object.keys(now ?? {})]);
  for (const k of keys) {
    const a = JSON.stringify(was?.[k]);
    const b = JSON.stringify(now?.[k]);
    if (a !== b) failures.push(`${label} · ${k}\n      was: ${a}\n      now: ${b}`);
  }
};

const index = (list) => Object.fromEntries(list.map((x) => [x.label, x]));
const wasReels = index(previous.reels ?? []);
const nowReels = index(current.reels);
for (const label of new Set([...Object.keys(wasReels), ...Object.keys(nowReels)])) {
  compare(wasReels[label], nowReels[label], label);
}
const wasT = index(previous.templates ?? []);
const nowT = index(current.templates);
for (const label of new Set([...Object.keys(wasT), ...Object.keys(nowT)])) {
  compare(wasT[label], nowT[label], label);
}

// Independent of the baseline: these must hold on their own terms.
for (const r of current.reels) {
  if (r.error) failures.push(`${r.label} · ${r.error}`);
  else if (!r.roundTripIdempotent) failures.push(`${r.label} · round-trip does not settle: a second extract→import→extract still changes the document`);
  else if (r.importErrors > 0) failures.push(`${r.label} · engine output has ${r.importErrors} import errors`);
}
for (const t of current.templates) {
  if (!t.ok) failures.push(`${t.label} · no longer parses: ${(t.errors ?? []).join('; ')}`);
  else if (!t.roundTripIdempotent) failures.push(`${t.label} · round-trip does not settle`);
}

if (failures.length === 0) {
  console.log(
    `baseline OK — ${current.reels.length} reels, ${current.templates.length} templates, ` +
    `round-trip settles, no schema drift`,
  );
  process.exit(0);
}

console.error(`baseline FAILED — ${failures.length} difference(s):\n`);
for (const f of failures) console.error('  • ' + f);
console.error(
  '\nIf a change here is intended, re-record with:\n' +
  '  node scripts/baseline.mjs --write\n',
);
process.exit(1);
