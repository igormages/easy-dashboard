import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class LineCounter {
  private cache: Record<string, { lines: number; timestamp: number }> = {};
  private cachePath: string;
  private TTL = 1000 * 60 * 60 * 24; // 24 hours

  constructor(context: vscode.ExtensionContext) {
    this.cachePath = path.join(context.globalStorageUri.fsPath, 'line-counts.json');
    this.loadCache();
  }

  private loadCache() {
    try {
      if (fs.existsSync(this.cachePath)) {
        this.cache = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      }
    } catch (e) {
      console.error('Failed to load line count cache', e);
    }
  }

  private saveCache() {
    try {
      fs.writeFileSync(this.cachePath, JSON.stringify(this.cache));
    } catch (e) {
      console.error('Failed to save line count cache', e);
    }
  }

  public async countLines(projectPath: string): Promise<number> {
    const cached = this.cache[projectPath];
    if (cached && (Date.now() - cached.timestamp < this.TTL)) {
      return cached.lines;
    }

    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(projectPath));
      if ((stat.type & vscode.FileType.Directory) === 0) {
        return 0;
      }

      let totalLines = 0;
      const ignorePatterns = ['node_modules', '.git', 'dist', 'build', 'out', 'coverage'];

      const countInDir = async (dirPath: string) => {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
        for (const [name, type] of entries) {
          if (ignorePatterns.includes(name)) continue;
          
          const fullPath = path.join(dirPath, name);
          if (type === vscode.FileType.Directory) {
            await countInDir(fullPath);
          } else if (type === vscode.FileType.File) {
            // Only count text files (basic heuristic)
            if (name.match(/\.(ts|js|tsx|jsx|json|html|css|scss|md|py|java|c|cpp|go|rs|rb|php)$/i)) {
              try {
                const content = await vscode.workspace.fs.readFile(vscode.Uri.file(fullPath));
                const text = new TextDecoder().decode(content);
                totalLines += text.split('\n').length;
              } catch (e) {
                // Ignore read errors
              }
            }
          }
        }
      };

      await countInDir(projectPath);
      
      this.cache[projectPath] = { lines: totalLines, timestamp: Date.now() };
      this.saveCache();
      
      return totalLines;
    } catch (e) {
      console.error(`Failed to count lines for ${projectPath}`, e);
      return 0;
    }
  }
}
