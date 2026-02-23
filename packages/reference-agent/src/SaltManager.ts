import * as fs from 'fs';
import * as path from 'path';

interface SaltEntry {
  matchId: string;
  round: number;
  move: number;
  salt: string;
}

export class SaltManager {
  private filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(baseDir: string = '.') {
    this.filePath = path.join(baseDir, 'salts.json');
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify([]));
    }
  }

  /**
   * Saves a move and salt using an atomic queue to prevent race conditions.
   */
  async saveSalt(entry: SaltEntry): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as SaltEntry[];
      const filtered = data.filter(e => !(e.matchId === entry.matchId && e.round === entry.round));
      filtered.push(entry);
      
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(filtered, null, 2));
      fs.renameSync(tempPath, this.filePath);
      console.log(`✅ Atomic Persist: Match ${entry.matchId} Round ${entry.round}`);
    });
    return this.writeQueue;
  }

  /**
   * Retrieves a salt, ensuring all pending writes are complete first.
   */
  async getSalt(matchId: string, round: number): Promise<SaltEntry | undefined> {
    // Chain onto the writeQueue to ensure we read AFTER any pending writes
    return this.writeQueue.then(() => {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as SaltEntry[];
      return data.find(e => e.matchId === matchId && e.round === round);
    });
  }

  async clearMatch(matchId: string): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as SaltEntry[];
      const filtered = data.filter(e => e.matchId !== matchId);
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(filtered, null, 2));
      fs.renameSync(tempPath, this.filePath);
    });
    return this.writeQueue;
  }
}
