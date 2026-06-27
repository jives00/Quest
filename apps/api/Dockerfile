FROM node:24-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY tsconfig.json pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

RUN pnpm install --ignore-scripts
RUN pnpm --filter @quest/types build
RUN pnpm --filter @quest/api build
RUN pnpm --filter @quest/api deploy --legacy --prod /deploy

FROM node:24-alpine

WORKDIR /app

COPY --from=builder /deploy/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./dist

EXPOSE 3007
CMD ["node", "dist/server.js"]
