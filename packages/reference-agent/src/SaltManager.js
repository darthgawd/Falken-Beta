import * as fs from 'fs';
import * as path from 'path';
export class SaltManager {
    filePath;
    writeQueue = Promise.resolve();
    constructor(baseDir = '.') {
        this.filePath = path.join(baseDir, 'salts.json');
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify([]));
        }
    }
    /**
     * Saves a move and salt using an atomic queue to prevent race conditions.
     */
    async saveSalt(entry) {
        this.writeQueue = this.writeQueue.then(async () => {
            const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
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
    async getSalt(matchId, round) {
        // Chain onto the writeQueue to ensure we read AFTER any pending writes
        return this.writeQueue.then(() => {
            const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            return data.find(e => e.matchId === matchId && e.round === round);
        });
    }
    async clearMatch(matchId) {
        this.writeQueue = this.writeQueue.then(async () => {
            const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            const filtered = data.filter(e => e.matchId !== matchId);
            const tempPath = `${this.filePath}.tmp`;
            fs.writeFileSync(tempPath, JSON.stringify(filtered, null, 2));
            fs.renameSync(tempPath, this.filePath);
        });
        return this.writeQueue;
    }
}
