FROM node:24-alpine AS builder

ARG NEXT_PUBLIC_API_URL
ARG API_URL=http://quest-api:3007

WORKDIR /app

RUN npm install -g pnpm

COPY tsconfig.json pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/

RUN pnpm install --ignore-scripts && pnpm rebuild sharp
RUN pnpm --filter @quest/types build
RUN NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL API_URL=$API_URL pnpm --filter @quest/web build

RUN cp -r apps/web/public apps/web/.next/standalone/apps/web/public && \
    cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static

FROM node:24-alpine

WORKDIR /app

COPY --from=builder /app/apps/web/.next/standalone ./

EXPOSE 3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
