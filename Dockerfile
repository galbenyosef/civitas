# Single image: Node serves the built client (/), the offline build (/play/) and the WebSocket world on one port.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --no-audit --no-fund
COPY . .
# GIT_SHA (a build arg) is the build id on the home page's footer: the image has no .git
ARG GIT_SHA=
ENV GIT_SHA=$GIT_SHA
# the online client (dist/) and the offline build (dist-local/, served under /play/ so the home page can offer the in-browser game)
RUN npm run build && npm run build:local

FROM node:20-alpine
WORKDIR /app
# Demo worlds go beside the world file, under /data/demos/. A read-only public showcase sets SPECTATE=1 and
# DEFAULT_DEMO=<id> (e.g. london) when it runs the image (docs/demo.md, "A public showcase"). With SPECTATE the server builds every
# sample city at start, one at a time (WARM_DEMOS, default all; KEEP_DEMOS, default DEFAULT_DEMO, stay running), and builds again any
# whose scenario changed: size the container for one warming child plus the kept ones (docs/demo.md, "Warming and rebuilding").
ENV NODE_ENV=production PORT=8080 WORLD_FILE=/data/world.json
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/server ./packages/server
COPY --from=build /app/packages/client/dist ./packages/client/dist
COPY --from=build /app/packages/client/dist-local ./packages/client/dist-local
VOLUME /data
EXPOSE 8080
CMD ["npm", "start"]
