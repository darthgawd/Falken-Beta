interface SaltEntry {
    matchId: string;
    round: number;
    move: number;
    salt: string;
}
export declare class SaltManager {
    private filePath;
    private writeQueue;
    constructor(baseDir?: string);
    /**
     * Saves a move and salt using an atomic queue to prevent race conditions.
     */
    saveSalt(entry: SaltEntry): Promise<void>;
    /**
     * Retrieves a salt, ensuring all pending writes are complete first.
     */
    getSalt(matchId: string, round: number): Promise<SaltEntry | undefined>;
    clearMatch(matchId: string): Promise<void>;
}
export {};
