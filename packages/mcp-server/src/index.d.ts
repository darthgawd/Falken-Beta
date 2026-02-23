import { Server } from '@modelcontextprotocol/sdk/server/index.js';
export declare const TOOLS: ({
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties?: undefined;
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            address: {
                type: string;
            };
            gameType?: undefined;
            stakeTier?: undefined;
            logicAddress?: undefined;
            matchId?: undefined;
            playerAddress?: undefined;
            stakeWei?: undefined;
            gameLogicAddress?: undefined;
            move?: undefined;
            salt?: undefined;
            approved?: undefined;
            adminAddress?: undefined;
            opponentAddress?: undefined;
            to?: undefined;
            data?: undefined;
            value?: undefined;
            gasLimit?: undefined;
            message?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            gameType: {
                type: string;
            };
            stakeTier: {
                type: string;
            };
            address?: undefined;
            logicAddress?: undefined;
            matchId?: undefined;
            playerAddress?: undefined;
            stakeWei?: undefined;
            gameLogicAddress?: undefined;
            move?: undefined;
            salt?: undefined;
            approved?: undefined;
            adminAddress?: undefined;
            opponentAddress?: undefined;
            to?: undefined;
            data?: undefined;
            value?: undefined;
            gasLimit?: undefined;
            message?: undefined;
        };
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            logicAddress: {
                type: string;
            };
            address?: undefined;
            gameType?: undefined;
            stakeTier?: undefined;
            matchId?: undefined;
            playerAddress?: undefined;
            stakeWei?: undefined;
            gameLogicAddress?: undefined;
            move?: undefined;
            salt?: undefined;
            approved?: undefined;
            adminAddress?: undefined;
            opponentAddress?: undefined;
            to?: undefined;
            data?: undefined;
            value?: undefined;
            gasLimit?: undefined;
            message?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            matchId: {
                type: string;
            };
            playerAddress: {
                type: string;
            };
            address?: undefined;
            gameType?: undefined;
            stakeTier?: undefined;
            logicAddress?: undefined;
            stakeWei?: undefined;
            gameLogicAddress?: undefined;
            move?: undefined;
            salt?: undefined;
            approved?: undefined;
            adminAddress?: undefined;
            opponentAddress?: undefined;
            to?: undefined;
            data?: undefined;
            value?: undefined;
            gasLimit?: undefined;
            message?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            stakeWei: {
                type: string;
            };
            gameLogicAddress: {
                type: string;
            };
            playerAddress: {
                type: string;
            };
            address?: undefined;
            gameType?: undefined;
            stakeTier?: undefined;
            logicAddress?: undefined;
            matchId?: undefined;
            move?: undefined;
            salt?: undefined;
            approved?: undefined;
            adminAddress?: undefined;
            opponentAddress?: undefined;
            to?: undefined;
            data?: undefined;
            value?: undefined;
            gasLimit?: undefined;
            message?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            matchId: {
                type: string;
            };
            playerAddress: {
                type: string;
            };
            move: {
                type: string;
            };
            address?: undefined;
            gameType?: undefined;
            stakeTier?: undefined;
            logicAddress?: undefined;
            stakeWei?: undefined;
            gameLogicAddress?: undefined;
            salt?: undefined;
            approved?: undefined;
            adminAddress?: undefined;
            opponentAddress?: undefined;
            to?: undefined;
            data?: undefined;
            value?: undefined;
            gasLimit?: undefined;
            message?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            matchId: {
                type: string;
            };
            move: {
                type: string;
            };
            salt: {
                type: string;
            };
            playerAddress: {
                type: string;
            };
            address?: undefined;
            gameType?: undefined;
            stakeTier?: undefined;
            logicAddress?: undefined;
            stakeWei?: undefined;
            gameLogicAddress?: undefined;
            approved?: undefined;
            adminAddress?: undefined;
            opponentAddress?: undefined;
            to?: undefined;
            data?: undefined;
            value?: undefined;
            gasLimit?: undefined;
            message?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            logicAddress: {
                type: string;
            };
            approved: {
                type: string;
            };
            adminAddress: {
                type: string;
            };
            address?: undefined;
            gameType?: undefined;
            stakeTier?: undefined;
            matchId?: undefined;
            playerAddress?: undefined;
            stakeWei?: undefined;
            gameLogicAddress?: undefined;
            move?: undefined;
            salt?: undefined;
            opponentAddress?: undefined;
            to?: undefined;
            data?: undefined;
            value?: undefined;
            gasLimit?: undefined;
            message?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            opponentAddress: {
                type: string;
            };
            address?: undefined;
            gameType?: undefined;
            stakeTier?: undefined;
            logicAddress?: undefined;
            matchId?: undefined;
            playerAddress?: undefined;
            stakeWei?: undefined;
            gameLogicAddress?: undefined;
            move?: undefined;
            salt?: undefined;
            approved?: undefined;
            adminAddress?: undefined;
            to?: undefined;
            data?: undefined;
            value?: undefined;
            gasLimit?: undefined;
            message?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            to: {
                type: string;
            };
            data: {
                type: string;
            };
            value: {
                type: string;
            };
            gasLimit: {
                type: string;
            };
            address?: undefined;
            gameType?: undefined;
            stakeTier?: undefined;
            logicAddress?: undefined;
            matchId?: undefined;
            playerAddress?: undefined;
            stakeWei?: undefined;
            gameLogicAddress?: undefined;
            move?: undefined;
            salt?: undefined;
            approved?: undefined;
            adminAddress?: undefined;
            opponentAddress?: undefined;
            message?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            message: {
                type: string;
            };
            address?: undefined;
            gameType?: undefined;
            stakeTier?: undefined;
            logicAddress?: undefined;
            matchId?: undefined;
            playerAddress?: undefined;
            stakeWei?: undefined;
            gameLogicAddress?: undefined;
            move?: undefined;
            salt?: undefined;
            approved?: undefined;
            adminAddress?: undefined;
            opponentAddress?: undefined;
            to?: undefined;
            data?: undefined;
            value?: undefined;
            gasLimit?: undefined;
        };
        required?: undefined;
    };
})[];
export declare function handleToolCall(name: string, args: any): Promise<any[] | {
    to: `0x${string}`;
    data: `0x${string}`;
    value: string;
    gasLimit: string;
} | {
    activeMatches: number;
    tvlWei: string;
    gameType?: undefined;
    moveLabels?: undefined;
    address?: undefined;
    balanceWei?: undefined;
    ready?: undefined;
    match?: undefined;
    rounds?: undefined;
    recommendedNextAction?: undefined;
    matchId?: undefined;
    round?: undefined;
    playerAddress?: undefined;
    instructions?: undefined;
    profile?: undefined;
    totalRoundsPlayed?: undefined;
    winCount?: undefined;
    error?: undefined;
    recentMatches?: undefined;
    hash?: undefined;
    status?: undefined;
    explorerUrl?: undefined;
    message?: undefined;
    timestamp?: undefined;
} | {
    gameType: string;
    moveLabels: Record<number, string>;
    activeMatches?: undefined;
    tvlWei?: undefined;
    address?: undefined;
    balanceWei?: undefined;
    ready?: undefined;
    match?: undefined;
    rounds?: undefined;
    recommendedNextAction?: undefined;
    matchId?: undefined;
    round?: undefined;
    playerAddress?: undefined;
    instructions?: undefined;
    profile?: undefined;
    totalRoundsPlayed?: undefined;
    winCount?: undefined;
    error?: undefined;
    recentMatches?: undefined;
    hash?: undefined;
    status?: undefined;
    explorerUrl?: undefined;
    message?: undefined;
    timestamp?: undefined;
} | {
    address: `0x${string}`;
    balanceWei: string;
    ready: boolean;
    activeMatches?: undefined;
    tvlWei?: undefined;
    gameType?: undefined;
    moveLabels?: undefined;
    match?: undefined;
    rounds?: undefined;
    recommendedNextAction?: undefined;
    matchId?: undefined;
    round?: undefined;
    playerAddress?: undefined;
    instructions?: undefined;
    profile?: undefined;
    totalRoundsPlayed?: undefined;
    winCount?: undefined;
    error?: undefined;
    recentMatches?: undefined;
    hash?: undefined;
    status?: undefined;
    explorerUrl?: undefined;
    message?: undefined;
    timestamp?: undefined;
} | {
    match: any;
    rounds: any[] | null;
    recommendedNextAction: string;
    activeMatches?: undefined;
    tvlWei?: undefined;
    gameType?: undefined;
    moveLabels?: undefined;
    address?: undefined;
    balanceWei?: undefined;
    ready?: undefined;
    matchId?: undefined;
    round?: undefined;
    playerAddress?: undefined;
    instructions?: undefined;
    profile?: undefined;
    totalRoundsPlayed?: undefined;
    winCount?: undefined;
    error?: undefined;
    recentMatches?: undefined;
    hash?: undefined;
    status?: undefined;
    explorerUrl?: undefined;
    message?: undefined;
    timestamp?: undefined;
} | {
    matchId: string;
    round: any;
    playerAddress: string;
    instructions: string;
    activeMatches?: undefined;
    tvlWei?: undefined;
    gameType?: undefined;
    moveLabels?: undefined;
    address?: undefined;
    balanceWei?: undefined;
    ready?: undefined;
    match?: undefined;
    rounds?: undefined;
    recommendedNextAction?: undefined;
    profile?: undefined;
    totalRoundsPlayed?: undefined;
    winCount?: undefined;
    error?: undefined;
    recentMatches?: undefined;
    hash?: undefined;
    status?: undefined;
    explorerUrl?: undefined;
    message?: undefined;
    timestamp?: undefined;
} | {
    salt: `0x${string}`;
    move: number;
    matchId: string;
    persistence_required: boolean;
    to: `0x${string}`;
    data: `0x${string}`;
    value: string;
    gasLimit: string;
    activeMatches?: undefined;
    tvlWei?: undefined;
    gameType?: undefined;
    moveLabels?: undefined;
    address?: undefined;
    balanceWei?: undefined;
    ready?: undefined;
    match?: undefined;
    rounds?: undefined;
    recommendedNextAction?: undefined;
    round?: undefined;
    playerAddress?: undefined;
    instructions?: undefined;
    profile?: undefined;
    totalRoundsPlayed?: undefined;
    winCount?: undefined;
    error?: undefined;
    recentMatches?: undefined;
    hash?: undefined;
    status?: undefined;
    explorerUrl?: undefined;
    message?: undefined;
    timestamp?: undefined;
} | {
    profile: any;
    totalRoundsPlayed: number;
    winCount: number;
    activeMatches?: undefined;
    tvlWei?: undefined;
    gameType?: undefined;
    moveLabels?: undefined;
    address?: undefined;
    balanceWei?: undefined;
    ready?: undefined;
    match?: undefined;
    rounds?: undefined;
    recommendedNextAction?: undefined;
    matchId?: undefined;
    round?: undefined;
    playerAddress?: undefined;
    instructions?: undefined;
    error?: undefined;
    recentMatches?: undefined;
    hash?: undefined;
    status?: undefined;
    explorerUrl?: undefined;
    message?: undefined;
    timestamp?: undefined;
} | {
    error: string;
    activeMatches?: undefined;
    tvlWei?: undefined;
    gameType?: undefined;
    moveLabels?: undefined;
    address?: undefined;
    balanceWei?: undefined;
    ready?: undefined;
    match?: undefined;
    rounds?: undefined;
    recommendedNextAction?: undefined;
    matchId?: undefined;
    round?: undefined;
    playerAddress?: undefined;
    instructions?: undefined;
    profile?: undefined;
    totalRoundsPlayed?: undefined;
    winCount?: undefined;
    recentMatches?: undefined;
    hash?: undefined;
    status?: undefined;
    explorerUrl?: undefined;
    message?: undefined;
    timestamp?: undefined;
} | {
    profile: any;
    recentMatches: {
        match_id: any;
        status: any;
        winner: any;
        wins_a: any;
        wins_b: any;
        created_at: any;
    }[];
    activeMatches?: undefined;
    tvlWei?: undefined;
    gameType?: undefined;
    moveLabels?: undefined;
    address?: undefined;
    balanceWei?: undefined;
    ready?: undefined;
    match?: undefined;
    rounds?: undefined;
    recommendedNextAction?: undefined;
    matchId?: undefined;
    round?: undefined;
    playerAddress?: undefined;
    instructions?: undefined;
    totalRoundsPlayed?: undefined;
    winCount?: undefined;
    error?: undefined;
    hash?: undefined;
    status?: undefined;
    explorerUrl?: undefined;
    message?: undefined;
    timestamp?: undefined;
} | {
    address: `0x${string}`;
    activeMatches?: undefined;
    tvlWei?: undefined;
    gameType?: undefined;
    moveLabels?: undefined;
    balanceWei?: undefined;
    ready?: undefined;
    match?: undefined;
    rounds?: undefined;
    recommendedNextAction?: undefined;
    matchId?: undefined;
    round?: undefined;
    playerAddress?: undefined;
    instructions?: undefined;
    profile?: undefined;
    totalRoundsPlayed?: undefined;
    winCount?: undefined;
    error?: undefined;
    recentMatches?: undefined;
    hash?: undefined;
    status?: undefined;
    explorerUrl?: undefined;
    message?: undefined;
    timestamp?: undefined;
} | {
    hash: `0x${string}`;
    status: string;
    explorerUrl: string;
    activeMatches?: undefined;
    tvlWei?: undefined;
    gameType?: undefined;
    moveLabels?: undefined;
    address?: undefined;
    balanceWei?: undefined;
    ready?: undefined;
    match?: undefined;
    rounds?: undefined;
    recommendedNextAction?: undefined;
    matchId?: undefined;
    round?: undefined;
    playerAddress?: undefined;
    instructions?: undefined;
    profile?: undefined;
    totalRoundsPlayed?: undefined;
    winCount?: undefined;
    error?: undefined;
    recentMatches?: undefined;
    message?: undefined;
    timestamp?: undefined;
} | {
    status: string;
    message: string;
    timestamp: string;
    activeMatches?: undefined;
    tvlWei?: undefined;
    gameType?: undefined;
    moveLabels?: undefined;
    address?: undefined;
    balanceWei?: undefined;
    ready?: undefined;
    match?: undefined;
    rounds?: undefined;
    recommendedNextAction?: undefined;
    matchId?: undefined;
    round?: undefined;
    playerAddress?: undefined;
    instructions?: undefined;
    profile?: undefined;
    totalRoundsPlayed?: undefined;
    winCount?: undefined;
    error?: undefined;
    recentMatches?: undefined;
    hash?: undefined;
    explorerUrl?: undefined;
}>;
export declare const server: Server<{
    method: string;
    params?: {
        [x: string]: unknown;
        _meta?: {
            [x: string]: unknown;
            progressToken?: string | number | undefined;
            "io.modelcontextprotocol/related-task"?: {
                taskId: string;
            } | undefined;
        } | undefined;
    } | undefined;
}, {
    method: string;
    params?: {
        [x: string]: unknown;
        _meta?: {
            [x: string]: unknown;
            progressToken?: string | number | undefined;
            "io.modelcontextprotocol/related-task"?: {
                taskId: string;
            } | undefined;
        } | undefined;
    } | undefined;
}, {
    [x: string]: unknown;
    _meta?: {
        [x: string]: unknown;
        progressToken?: string | number | undefined;
        "io.modelcontextprotocol/related-task"?: {
            taskId: string;
        } | undefined;
    } | undefined;
}>;
