/**
 * The project store.
 *
 * Flarent has no database and no server-side project storage — the editor keeps
 * one project in `localStorage`. MCP needs many projects and needs them from
 * Node, so this is that storage, and it is deliberately the thinnest thing that
 * can work:
 *
 *     .flarent/projects/<project-id>.json
 *
 * **Each file is exactly `serialiseProject` output — nothing more.** No wrapper
 * object, no MCP envelope, no added fields. Two consequences, both the point:
 *
 *  1. The existing editor can open any MCP-authored project *today*, through the
 *     "Import JSON" door it already has, with no change to the editor at all.
 *  2. There is no second project format to keep in sync, so `templates/SCHEMA.md`
 *     stays the single description of what a Flarent project is.
 *
 * **Where the metadata went.** A project id is the filename; `createdAt` and
 * `updatedAt` are the file's own `birthtime` and `mtime`; the title is the
 * document's own `title` field. That is the whole metadata model, and it needs
 * no sidecar file and no schema contamination to work.
 *
 * **What does not round-trip.** The `palette` *name* (forest/ink) is inferred by
 * the parser from whether any scene uses a black field, not stored, so it stays
 * read-only here. The palette's actual colours do round-trip: `backgroundPalette`,
 * `inkPalette` and `accentColor` are all written and read back. Scene durations are snapped onto the frame grid by the parser,
 * so a duration written as 0.85s reads back as 0.867s and then holds steady;
 * that is the engine's existing behaviour and the regression gate asserts it.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { DATA_DIR, loadEngine } from './engine.mjs';
import { conflict, notFound, validationError } from './errors.mjs';

const STORE_DIR = path.join(DATA_DIR, 'projects');

/**
 * Project ids are `prj_` plus 12 hex characters.
 *
 * Narrow on purpose. The id becomes a filename, so anything that could contain
 * a separator or a `..` is a path-traversal vector — and §25 is explicit that
 * this server must not offer arbitrary filesystem access. Validating the *shape*
 * rather than sanitising the value means there is nothing to get subtly wrong.
 */
const ID_PATTERN = /^prj_[0-9a-f]{12}$/;

export const newProjectId = () => `prj_${crypto.randomBytes(6).toString('hex')}`;

export const assertProjectId = (id) => {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw validationError(
      `"${id}" is not a valid project id. Ids look like prj_a1b2c3d4e5f6; list_projects returns them.`,
      { field: 'projectId' },
    );
  }
  return id;
};

const fileFor = (id) => path.join(STORE_DIR, `${assertProjectId(id)}.json`);

const ensureDir = () => fsp.mkdir(STORE_DIR, { recursive: true });

/* ------------------------------------------------------------------- read */

/**
 * A stored project, parsed through the engine's own importer.
 *
 * Parsing rather than trusting the bytes matters: the file could have been
 * hand-edited, or written by an older build. `parseFlarentScript` is
 * all-or-nothing and treats unknown enum values as errors, so a project either
 * loads exactly as the engine understands it or fails loudly here.
 */
export const readProject = async (id) => {
  const engine = await loadEngine();
  const file = fileFor(id);

  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch {
    throw notFound(`Project ${id} does not exist.`, { projectId: id });
  }

  const parsed = engine.parseFlarentScript(raw);
  if (!parsed.ok) {
    throw conflict(
      `Project ${id} is on disk but is not a valid Flarent document.`,
      { projectId: id, issues: parsed.issues.slice(0, 10) },
    );
  }

  const stat = await fsp.stat(file);
  return {
    id,
    project: parsed.project,
    createdAt: stat.birthtime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
    warnings: parsed.issues.filter((issue) => issue.severity === 'warning'),
  };
};

/* ------------------------------------------------------------------ write */

/**
 * Serialise and write, atomically and durably.
 *
 * Write-to-temp-then-rename because a crash midway through a plain write leaves
 * a truncated file, and a truncated project is one the parser above will refuse
 * to load — turning a lost render into a lost project. The temp file is fsynced
 * before the rename because the rename alone orders the directory entry and not
 * the data behind it; see the comments in the body.
 */
export const writeProject = async (id, project) => {
  const engine = await loadEngine();
  await ensureDir();

  const json = engine.serialiseProject(
    project.scenes,
    project.title ?? null,
    project.fields ?? {},
    project.overlay ?? null,
    project.format ?? 'portrait',
    project.audio ?? null,
    project.ink ?? {},
    project.accent ?? null,
  );

  /**
   * The serialiser is the only thing that decides what a project file says, so
   * if its output does not parse, the bug is upstream and the right move is to
   * keep the last good file rather than replace it with something unreadable.
   */
  try {
    JSON.parse(json);
  } catch (cause) {
    throw validationError(
      `Refusing to write project ${id}: the serialised document is not valid JSON.`,
      { cause: cause.message },
    );
  }

  const file = fileFor(id);
  /**
   * The suffix carries randomness as well as the pid because pids are recycled,
   * and a recycled pid meeting a temp file left behind by a killed process is
   * two writers sharing one path.
   */
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;

  /**
   * Write, flush, *then* rename.
   *
   * The rename is what makes the swap atomic, but it only orders the directory
   * entry — it does not order the file's own data. Without the fsync the
   * rename can be durable while the bytes behind it are not, and the file that
   * survives is the new length with stale blocks past the end of what actually
   * reached disk: a document that parses and then has garbage after it. That is
   * not theoretical here, it is the failure that was observed.
   */
  let handle;
  try {
    handle = await fsp.open(temp, 'w');
    await handle.writeFile(json);
    await handle.sync();
  } finally {
    await handle?.close();
  }
  await fsp.rename(temp, file);

  /**
   * And the directory entry itself, so the rename survives a crash too. Best
   * effort: some platforms refuse to open a directory for sync, and failing to
   * harden a write that already succeeded is not a reason to fail the call.
   */
  try {
    const dir = await fsp.open(STORE_DIR, 'r');
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } catch {
    /* not fatal */
  }

  return id;
};

/**
 * Read, transform, write — the shape every mutating tool wants.
 *
 * Centralised so no tool has to remember the read/serialise pair, and so the
 * "what does the caller get back" answer is the same everywhere: the project as
 * it is *after* the engine has re-parsed it, which is the version that will
 * actually render.
 */
export const mutateProject = async (id, mutate) => {
  const before = await readProject(id);
  const next = await mutate(structuredClone(before.project), before);
  await writeProject(id, next);
  return readProject(id);
};

/* ------------------------------------------------------------- list/create */

export const createProject = async (project, id = newProjectId()) => {
  await ensureDir();
  if (fs.existsSync(fileFor(id))) {
    throw conflict(`Project ${id} already exists.`, { projectId: id });
  }
  await writeProject(id, project);
  return readProject(id);
};

/**
 * Every stored project, newest first.
 *
 * Deliberately shallow — id, title, duration, scene count and timestamps — so
 * listing a hundred projects costs a model a short list rather than a hundred
 * documents. A file that fails to parse is reported with an `error` marker
 * instead of being hidden or throwing, because a project the user can see in
 * their folder but not in `list_projects` is the more confusing failure.
 */
export const listProjects = async () => {
  const engine = await loadEngine();
  await ensureDir();

  const names = (await fsp.readdir(STORE_DIR)).filter((name) => name.endsWith('.json'));
  const rows = [];

  for (const name of names) {
    const id = name.replace(/\.json$/, '');
    if (!ID_PATTERN.test(id)) continue;
    const file = path.join(STORE_DIR, name);
    const stat = await fsp.stat(file);
    try {
      const parsed = engine.parseFlarentScript(await fsp.readFile(file, 'utf8'));
      if (!parsed.ok) {
        rows.push({ projectId: id, error: 'unparseable', updatedAt: stat.mtime.toISOString() });
        continue;
      }
      rows.push({
        projectId: id,
        title: parsed.project.title,
        format: parsed.project.format,
        sceneCount: parsed.project.scenes.length,
        duration: Number(parsed.project.durationSeconds.toFixed(3)),
        hasAudio: parsed.project.audio !== null,
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
      });
    } catch {
      rows.push({ projectId: id, error: 'unreadable', updatedAt: stat.mtime.toISOString() });
    }
  }

  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const deleteProject = async (id) => {
  const file = fileFor(id);
  if (!fs.existsSync(file)) {
    throw notFound(`Project ${id} does not exist.`, { projectId: id });
  }
  await fsp.rm(file);
  return id;
};

export const projectExists = (id) =>
  ID_PATTERN.test(String(id)) && fs.existsSync(path.join(STORE_DIR, `${id}.json`));

export { STORE_DIR };
