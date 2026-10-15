FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/marketing/package.json apps/marketing/package.json
RUN pnpm install --frozen-lockfile

# Every page is prerendered, so these are baked in at build time; changing one
# means rebuilding the image, not restarting the container.
FROM deps AS build
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_CONTACT_EMAIL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_CONTACT_EMAIL=$NEXT_PUBLIC_CONTACT_EMAIL
COPY packages/shared packages/shared
COPY apps/marketing apps/marketing
RUN pnpm --filter @saas/shared build && pnpm --filter marketing build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/marketing/.next/standalone ./
COPY --from=build /app/apps/marketing/.next/static ./apps/marketing/.next/static
WORKDIR /app/apps/marketing
EXPOSE 3000
CMD ["node", "server.js"]
