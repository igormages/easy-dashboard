import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import Util from './util';
import * as RootSync from './projects-root-sync';

export interface ActivitySession {
	path: string;
	start: number;
	end: number;
}

export interface ProjectActivity {
  openCount: number;
  openHistory: Array<{ date: string; count: number }>;
  timeSpent: Array<{ date: string; minutes: number }>;
  linesChanged: Array<{ date: string; added: number; removed: number }>;
}

export interface ActivityData {
  projects: Record<string, ProjectActivity>;
  /** Intervalles de focus workspace (agrégation activité). Non exposé au webview. */
  sessions?: ActivitySession[];
  /** Minutes de focus agrégées (tous workspaces), UTC — 48 créneaux d’une heure pour le graphique. */
  focusByHour?: Array<{ hour: string; minutes: number }>;
}

export class ActivityTracker {
  private data: ActivityData = { projects: {} };
  private storagePath: string;
  private activeProject: string | null = null;
  private activeProjectStartTime: number = 0;
  private saveTimer: NodeJS.Timeout | null = null;
  private isDirty = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.storagePath = path.join(context.globalStorageUri.fsPath, 'activity.json');
    this.load();
    this.setupListeners();
    context.subscriptions.push(...this.disposables);
    this.updateActiveProject();
  }

  private load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const content = fs.readFileSync(this.storagePath, 'utf8');
        this.data = JSON.parse(content);
      }
    } catch (e) {
      console.error('Failed to load activity data', e);
      this.data = { projects: {}, sessions: [] };
    }
    if (!this.data.sessions) {
      this.data.sessions = [];
    }
  }

  private save() {
    if (!this.isDirty) return;
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2));
      this.isDirty = false;
    } catch (e) {
      console.error('Failed to save activity data', e);
    }
  }

  private scheduleSave() {
    this.isDirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 5000);
  }

  /** Jour calendaire local (YYYY-MM-DD), aligné sur le fuseau horaire de la machine — pas l’UTC de toISOString(). */
  private getTodayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private normalizeSessionPath(projectPath: string): string {
    if (RootSync.isRemoteOrNonLocalPath(projectPath)) {
      return projectPath.trim();
    }
    return Util.fixDriveLetters(projectPath);
  }

  private normalizeProjectKey(projectPath: string): string {
    return this.normalizeSessionPath(projectPath);
  }

  private pruneSessions() {
    if (!this.data.sessions?.length) {
      return;
    }
    const cutoff = Date.now() - 35 * 24 * 60 * 60 * 1000;
    this.data.sessions = this.data.sessions.filter((s) => s.end >= cutoff);
    const max = 120000;
    if (this.data.sessions.length > max) {
      this.data.sessions = this.data.sessions.slice(-max);
    }
  }

  private appendSession(projectPath: string, start: number, end: number) {
    if (!projectPath || end <= start) {
      return;
    }
    if (end - start < 1000) {
      return;
    }
    if (!this.data.sessions) {
      this.data.sessions = [];
    }
    this.data.sessions.push({
      path: this.normalizeSessionPath(projectPath),
      start,
      end,
    });
    this.pruneSessions();
    this.scheduleSave();
  }

  private initProjectData(projectId: string) {
    if (!this.data.projects[projectId]) {
      this.data.projects[projectId] = {
        openCount: 0,
        openHistory: [],
        timeSpent: [],
        linesChanged: []
      };
    }
    return this.data.projects[projectId];
  }

  public recordOpen(projectId: string) {
    const projectKey = this.normalizeProjectKey(projectId);
    const p = this.initProjectData(projectKey);
    p.openCount++;
    
    const today = this.getTodayStr();
    const todayEntry = p.openHistory.find(h => h.date === today);
    if (todayEntry) {
      todayEntry.count++;
    } else {
      p.openHistory.push({ date: today, count: 1 });
    }
    
    this.activeProject = projectKey;
    this.activeProjectStartTime = Date.now();
    this.scheduleSave();
  }

  private setupListeners() {
    this.disposables.push(vscode.window.onDidChangeActiveTextEditor(() => {
      this.updateActiveProject();
    }));

    this.disposables.push(vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) {
        this.updateActiveProject();
      } else {
        this.flushTimeSpent();
        this.activeProject = null;
      }
    }));

    this.disposables.push(vscode.workspace.onDidChangeTextDocument((e) => {
      if (!this.activeProject) return;
      if (e.document.uri.scheme !== 'file') return;
      
      let added = 0;
      let removed = 0;
      
      for (const change of e.contentChanges) {
        const newLines = change.text.split('\n').length - 1;
        const oldLines = change.range.end.line - change.range.start.line;
        if (newLines > oldLines) added += (newLines - oldLines);
        if (oldLines > newLines) removed += (oldLines - newLines);
      }

      if (added > 0 || removed > 0) {
        const p = this.initProjectData(this.activeProject);
        const today = this.getTodayStr();
        let entry = p.linesChanged.find(h => h.date === today);
        if (!entry) {
          entry = { date: today, added: 0, removed: 0 };
          p.linesChanged.push(entry);
        }
        entry.added += added;
        entry.removed += removed;
        this.scheduleSave();
      }
    }));
  }

  private updateActiveProject() {
    this.flushTimeSpent();
    
    const activeEditor = vscode.window.activeTextEditor;
    const activeFolder = activeEditor
      ? vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)
      : undefined;
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const folder = activeFolder ?? workspaceFolders?.[0];
    if (folder) {
      this.activeProject = this.normalizeProjectKey(folder.uri.fsPath);
      this.activeProjectStartTime = Date.now();
    } else {
      this.activeProject = null;
    }
  }

  private flushTimeSpent() {
    if (this.activeProject && this.activeProjectStartTime > 0) {
      const now = Date.now();
      const durationMs = now - this.activeProjectStartTime;
      const durationMinutes = Math.floor(durationMs / 60000);

      this.appendSession(this.activeProject, this.activeProjectStartTime, now);

      if (durationMinutes > 0) {
        const p = this.initProjectData(this.activeProject);
        const today = this.getTodayStr();
        let entry = p.timeSpent.find(h => h.date === today);
        if (!entry) {
          entry = { date: today, minutes: 0 };
          p.timeSpent.push(entry);
        }
        entry.minutes += durationMinutes;
        this.scheduleSave();
      }
    }
    this.activeProjectStartTime = Date.now();
  }

  public getData(): ActivityData {
    this.flushTimeSpent();
    return this.data;
  }

  /** Agrégats seulement (pas les sessions) pour le webview. */
  public getDataForWebview(): ActivityData {
    this.flushTimeSpent();
    return {
      projects: this.data.projects,
      focusByHour: this.getGlobalFocusMinutesByUtcHour(48),
    };
  }

  /** Chevauchement sessions / créneaux horaires UTC (pour graphique 48h). */
  public getGlobalFocusMinutesByUtcHour(numHours: number, nowMs: number = Date.now()): Array<{ hour: string; minutes: number }> {
    const sessions = this.getSessions();
    const hourMs = 60 * 60 * 1000;
    const endHour = Math.floor(nowMs / hourMs) * hourMs;
    const out: Array<{ hour: string; minutes: number }> = [];
    for (let i = numHours - 1; i >= 0; i--) {
      const hourStart = endHour - i * hourMs;
      const hourEnd = hourStart + hourMs;
      let ms = 0;
      for (const s of sessions) {
        const a = Math.max(s.start, hourStart);
        const b = Math.min(s.end, hourEnd);
        if (b > a) {
          ms += b - a;
        }
      }
      out.push({
        hour: new Date(hourStart).toISOString(),
        minutes: Math.round(ms / 60000),
      });
    }
    return out;
  }

  public getSessions(): ActivitySession[] {
    this.flushTimeSpent();
    return [...(this.data.sessions ?? [])];
  }
}
