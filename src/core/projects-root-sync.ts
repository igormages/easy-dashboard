import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import ProjectEntry from './project-entry';
import ProjectFolder from './project-folder';
import Util from './util';

export function sanitizeDiskSegment(name: string): string {
	const s = name.replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
	return s || 'untitled';
}

export function isRemoteOrNonLocalPath(p: string): boolean {
	if (!p) return true;
	const t = p.trim();
	if (/^vscode-remote:/i.test(t)) return true;
	if (/^ssh-remote:/i.test(t)) return true;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && !/^file:/i.test(t)) {
		return true;
	}
	return false;
}

export function toFsPath(p: string): string {
	if (p.startsWith('file:')) {
		return Util.fixDriveLetters(vscode.Uri.parse(p, true).fsPath);
	}
	return Util.fixDriveLetters(p);
}

function mkdirp(dir: string): void {
	fs.mkdirSync(dir, { recursive: true });
}

/** Dossier disponible : si `prefer` existe et est exactement ce chemin, le garder. */
export function uniqueChildDir(parentAbs: string, segment: string, preferFsPath?: string): string {
	const base = sanitizeDiskSegment(segment);
	let candidate = path.join(parentAbs, base);
	if (!fs.existsSync(candidate)) {
		return candidate;
	}
	if (preferFsPath && path.normalize(candidate) === path.normalize(preferFsPath)) {
		return candidate;
	}
	let n = 2;
	for (;;) {
		candidate = path.join(parentAbs, `${base}-${n}`);
		if (!fs.existsSync(candidate)) {
			return candidate;
		}
		if (preferFsPath && path.normalize(candidate) === path.normalize(preferFsPath)) {
			return candidate;
		}
		n += 1;
	}
}

function findFolderChain(
	items: Array<ProjectFolder | ProjectEntry>,
	folderId: string,
	prefix: ProjectFolder[] = []
): ProjectFolder[] | null {
	for (const item of items) {
		if (item instanceof ProjectFolder) {
			if (item.id === folderId) {
				return [...prefix, item];
			}
			const sub = findFolderChain(item.projects, folderId, [...prefix, item]);
			if (sub) {
				return sub;
			}
		}
	}
	return null;
}

/** `null` = racine du dashboard ; `undefined` = id introuvable */
function findParentFolderId(
	items: Array<ProjectFolder | ProjectEntry>,
	id: string,
	parentFolderId: string | null = null
): string | null | undefined {
	for (const item of items) {
		if (item.id === id) {
			return parentFolderId;
		}
		if (item instanceof ProjectFolder) {
			const r = findParentFolderId(item.projects, id, item.id);
			if (r !== undefined) {
				return r;
			}
		}
	}
	return undefined;
}

export function getExpectedFolderAbsPath(
	projectsRoot: string,
	database: Array<ProjectFolder | ProjectEntry>,
	folderId: string
): string | null {
	const chain = findFolderChain(database, folderId);
	if (!chain || chain.length === 0) {
		return null;
	}
	const parts = chain.map((f) => sanitizeDiskSegment(f.name));
	return path.join(projectsRoot, ...parts);
}

export function projectDiskSegment(entry: ProjectEntry): string {
	if (entry.diskSegment && entry.diskSegment.trim()) {
		return sanitizeDiskSegment(entry.diskSegment);
	}
	const fsPath = toFsPath(entry.path);
	const base = path.basename(fsPath);
	if (base) {
		return sanitizeDiskSegment(base);
	}
	return sanitizeDiskSegment(entry.name);
}

export function getExpectedProjectAbsPath(
	projectsRoot: string,
	database: Array<ProjectFolder | ProjectEntry>,
	entry: ProjectEntry
): string | null {
	const rawParent = findParentFolderId(database, entry.id);
	if (rawParent === undefined) {
		return null;
	}
	const parentAbs = rawParent !== null
		? getExpectedFolderAbsPath(projectsRoot, database, rawParent)
		: projectsRoot;
	if (!parentAbs) {
		return null;
	}
	const seg = projectDiskSegment(entry);
	return path.join(parentAbs, seg);
}

function moveOnDisk(oldPath: string, newPath: string): void {
	mkdirp(path.dirname(newPath));
	if (oldPath === newPath || path.normalize(oldPath) === path.normalize(newPath)) {
		return;
	}
	if (!fs.existsSync(oldPath)) {
		return;
	}
	try {
		fs.renameSync(oldPath, newPath);
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException;
		if (err.code === 'EXDEV') {
			copyDirRecursiveSync(oldPath, newPath);
			fs.rmSync(oldPath, { recursive: true, force: true });
			return;
		}
		throw e;
	}
}

function copyDirRecursiveSync(src: string, dest: string): void {
	mkdirp(dest);
	for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
		const s = path.join(src, ent.name);
		const d = path.join(dest, ent.name);
		if (ent.isDirectory()) {
			copyDirRecursiveSync(s, d);
		} else {
			fs.copyFileSync(s, d);
		}
	}
}

/** Crée l’arborescence de dossiers attendue (dossiers dashboard). */
export function ensureFolderDirectoriesExist(
	projectsRoot: string,
	database: Array<ProjectFolder | ProjectEntry>
): void {
	mkdirp(projectsRoot);

	function walk(items: Array<ProjectFolder | ProjectEntry>, parentAbs: string): void {
		for (const item of items) {
			if (item instanceof ProjectFolder) {
				const abs = path.join(parentAbs, sanitizeDiskSegment(item.name));
				mkdirp(abs);
				walk(item.projects, abs);
			}
		}
	}

	walk(database, projectsRoot);
}

/** Déplace chaque projet local vers le chemin attendu sous la racine. */
export function reconcileProjectPaths(
	projectsRoot: string,
	database: Array<ProjectFolder | ProjectEntry>
): string[] {
	const errors: string[] = [];

	function walk(items: Array<ProjectFolder | ProjectEntry>): void {
		for (const item of items) {
			if (item instanceof ProjectEntry) {
				if (isRemoteOrNonLocalPath(item.path)) {
					continue;
				}
				const cur = toFsPath(item.path);
				const expected = getExpectedProjectAbsPath(projectsRoot, database, item);
				if (!expected) {
					continue;
				}
				if (path.normalize(cur) === path.normalize(expected)) {
					continue;
				}
				let dest = expected;
				if (fs.existsSync(dest) && path.normalize(cur) !== path.normalize(dest)) {
					dest = uniqueChildDir(path.dirname(expected), path.basename(expected), cur);
				}
				try {
					moveOnDisk(cur, dest);
					item.path = dest;
					if (path.basename(dest) !== projectDiskSegment(item)) {
						item.diskSegment = path.basename(dest);
					}
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					errors.push(`${item.name}: ${msg}`);
				}
			} else {
				walk(item.projects);
			}
		}
	}

	walk(database);
	return errors;
}

/** Après déplacement logique d’un dossier : renommer le répertoire sur disque. */
export function moveFolderOnDisk(
	projectsRoot: string,
	database: Array<ProjectFolder | ProjectEntry>,
	folderId: string,
	previousAbsPath: string | null
): void {
	if (!previousAbsPath || !fs.existsSync(previousAbsPath)) {
		return;
	}
	const next = getExpectedFolderAbsPath(projectsRoot, database, folderId);
	if (!next) {
		return;
	}
	if (path.normalize(previousAbsPath) === path.normalize(next)) {
		return;
	}
	moveOnDisk(previousAbsPath, next);
}

export function moveLocalProjectOnDisk(
	projectsRoot: string,
	database: Array<ProjectFolder | ProjectEntry>,
	entry: ProjectEntry,
	previousFsPath: string
): void {
	if (isRemoteOrNonLocalPath(entry.path)) {
		return;
	}
	const next = getExpectedProjectAbsPath(projectsRoot, database, entry);
	if (!next) {
		return;
	}
	if (path.normalize(previousFsPath) === path.normalize(next)) {
		return;
	}
	let dest = next;
	if (fs.existsSync(dest) && path.normalize(previousFsPath) !== path.normalize(dest)) {
		dest = uniqueChildDir(path.dirname(next), path.basename(next), previousFsPath);
	}
	moveOnDisk(previousFsPath, dest);
	entry.path = dest;
	if (path.basename(dest) !== projectDiskSegment(entry)) {
		entry.diskSegment = path.basename(dest);
	}
}

export function renameFolderOnDisk(
	projectsRoot: string,
	database: Array<ProjectFolder | ProjectEntry>,
	folderId: string,
	oldName: string,
	newName: string
): void {
	const rawParent = findParentFolderId(database, folderId);
	if (rawParent === undefined) {
		return;
	}
	const parentId = rawParent;
	const parentAbs = parentId !== null
		? getExpectedFolderAbsPath(projectsRoot, database, parentId)
		: projectsRoot;
	if (!parentAbs) {
		return;
	}
	const from = path.join(parentAbs, sanitizeDiskSegment(oldName));
	const to = path.join(parentAbs, sanitizeDiskSegment(newName));
	if (from === to || path.normalize(from) === path.normalize(to)) {
		return;
	}
	if (!fs.existsSync(from)) {
		mkdirp(to);
		return;
	}
	moveOnDisk(from, to);
}
