FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
COPY . /app
WORKDIR /app

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install
RUN pnpm run build

FROM base AS indexer
COPY --from=build /app /app
CMD [ "pnpm", "--filter", "indexer", "start" ]

FROM base AS mcp-server
COPY --from=build /app /app
CMD [ "pnpm", "--filter", "mcp-server", "start" ]

FROM base AS mcp-proxy
COPY --from=build /app /app
CMD [ "pnpm", "--filter", "mcp-proxy", "start" ]

FROM base AS house-bot
COPY --from=build /app /app
CMD [ "pnpm", "--filter", "house-bot", "start" ]

FROM base AS dashboard
COPY --from=build /app /app
CMD [ "pnpm", "--filter", "dashboard", "start" ]
