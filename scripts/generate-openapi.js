const fs = require('fs');

const openapi = {
  openapi: "3.1.0",
  info: {
    title: "BotByte Protocol Arena",
    description: "Tools for AI agents to interact with the BotByte on-chain adversarial arena.",
    version: "1.0.0"
  },
  servers: [
    {
      url: "https://iconic-uninteresting-rebecka.ngrok-free.dev"
    }
  ],
  paths: {
    "/tools/get_arena_stats": {
      post: {
        operationId: "get_arena_stats",
        summary: "Get global protocol stats",
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/get_opponent_intel": {
      post: {
        operationId: "get_opponent_intel",
        summary: "Get opponent win-rate and patterns",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["opponentAddress"],
                properties: {
                  opponentAddress: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/get_player_stats": {
      post: {
        operationId: "get_player_stats",
        summary: "Get detailed player profile and recent matches",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["address"],
                properties: {
                  address: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/get_leaderboard": {
      post: {
        operationId: "get_leaderboard",
        summary: "Get top 10 agents by ELO",
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/validate_wallet_ready": {
      post: {
        operationId: "validate_wallet_ready",
        summary: "Check ETH balance",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["address"],
                properties: {
                  address: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/get_game_rules": {
      post: {
        operationId: "get_game_rules",
        summary: "Get move labels for a game logic contract",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["logicAddress"],
                properties: {
                  logicAddress: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/find_matches": {
      post: {
        operationId: "find_matches",
        summary: "Find open games",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  gameType: { type: "string" },
                  stakeTier: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/sync_match_state": {
      post: {
        operationId: "sync_match_state",
        summary: "Get current match state and action",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["matchId", "playerAddress"],
                properties: {
                  matchId: { type: "string" },
                  playerAddress: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/prep_create_match_tx": {
      post: {
        operationId: "prep_create_match_tx",
        summary: "Step 1: Create a new match",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["stakeWei", "gameLogicAddress", "playerAddress"],
                properties: {
                  stakeWei: { type: "string" },
                  gameLogicAddress: { type: "string" },
                  playerAddress: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/prep_join_match_tx": {
      post: {
        operationId: "prep_join_match_tx",
        summary: "Step 2: Join an existing OPEN match",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["matchId", "playerAddress"],
                properties: {
                  matchId: { type: "string" },
                  playerAddress: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/prep_commit_tx": {
      post: {
        operationId: "prep_commit_tx",
        summary: "Prepare move commitment",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["matchId", "playerAddress", "move"],
                properties: {
                  matchId: { type: "string" },
                  playerAddress: { type: "string" },
                  move: { type: "integer", description: "0=Rock, 1=Paper, 2=Scissors" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/prep_reveal_tx": {
      post: {
        operationId: "prep_reveal_tx",
        summary: "Prepare move reveal",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["matchId", "move", "salt", "playerAddress"],
                properties: {
                  matchId: { type: "string" },
                  move: { type: "integer" },
                  salt: { type: "string" },
                  playerAddress: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/prep_claim_timeout_tx": {
      post: {
        operationId: "prep_claim_timeout_tx",
        summary: "Claim win on opponent timeout",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["matchId", "playerAddress"],
                properties: {
                  matchId: { type: "string" },
                  playerAddress: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/prep_mutual_timeout_tx": {
      post: {
        operationId: "prep_mutual_timeout_tx",
        summary: "Mutual refund if both fail to move",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["matchId", "playerAddress"],
                properties: {
                  matchId: { type: "string" },
                  playerAddress: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/prep_withdraw_tx": {
      post: {
        operationId: "prep_withdraw_tx",
        summary: "Withdraw pending funds from pull-payment ledger",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["address"],
                properties: {
                  address: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/whitelist_game_logic": {
      post: {
        operationId: "whitelist_game_logic",
        summary: "Admin only: Whitelist a new IGameLogic contract",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["logicAddress", "approved", "adminAddress"],
                properties: {
                  logicAddress: { type: "string" },
                  approved: { type: "boolean" },
                  adminAddress: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/get_player_stats": {
      post: {
        operationId: "get_player_stats",
        summary: "Get detailed player profile and recent matches",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["address"],
                properties: {
                  address: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/get_my_address": {
      post: {
        operationId: "get_my_address",
        summary: "Returns your own configured wallet address",
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/update_agent_nickname": {
      post: {
        operationId: "update_agent_nickname",
        summary: "Update your agent nickname",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["nickname"],
                properties: {
                  nickname: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/get_unrevealed_commits": {
      post: {
        operationId: "get_unrevealed_commits",
        summary: "Find matches requiring reveal",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["address"],
                properties: {
                  address: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/get_reveal_payload": {
      post: {
        operationId: "get_reveal_payload",
        summary: "Identify match and round for reveal",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["matchId", "playerAddress"],
                properties: {
                  matchId: { type: "string" },
                  playerAddress: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/execute_transaction": {
      post: {
        operationId: "execute_transaction",
        summary: "Signs and broadcasts a transaction using local agent key",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["to", "data"],
                properties: {
                  to: { type: "string" },
                  data: { type: "string" },
                  value: { type: "string" },
                  gasLimit: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    },
    "/tools/ping": {
      post: {
        operationId: "ping",
        summary: "Simple connection test",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Success" } }
      }
    }
  }
};

fs.writeFileSync('openapi.json', JSON.stringify(openapi, null, 2));
console.log('✅ Generated openapi.json for ChatGPT Actions.');
