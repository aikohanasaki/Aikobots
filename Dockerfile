FROM node:24.18.0-alpine3.23@sha256:595398b0081eacda8e1c4c5b97b76cd1020e4d58a8ebcb4843b9bca1e79e7436

# Arguments
ARG APP_HOME=/home/node/app

# Install system dependencies
RUN apk add --no-cache gcompat tini git git-lfs

# Create app directory
WORKDIR ${APP_HOME}

# Set NODE_ENV to production
ENV NODE_ENV=production

# Bundle app source
COPY . ./

RUN \
  echo "*** Install npm packages ***" && \
  apk add --no-cache --virtual .native-build-deps python3 make g++ && \
  npm install --global npm@12.0.1 --no-audit --no-fund --loglevel=error --no-progress && \
  npm ci --omit=dev --no-audit --no-fund --loglevel=error --no-progress && \
  npm cache clean --force && \
  apk del .native-build-deps

# Create config directory and link config.yaml
RUN \
  rm -f "config.yaml" || true && \
  ln -s "./config/config.yaml" "config.yaml" || true && \
  mkdir "config" || true

# Set the entrypoint script
RUN \
  echo "*** Cleanup ***" && \
  mv "./docker/docker-entrypoint.sh" "./" && \
  rm -rf "./docker" && \
  echo "*** Make docker-entrypoint.sh executable ***" && \
  chmod +x "./docker-entrypoint.sh" && \
  echo "*** Convert line endings to Unix format ***" && \
  dos2unix "./docker-entrypoint.sh"

# Fix extension repos permissions
RUN git config --global --add safe.directory "*"

EXPOSE 8000

# Ensure proper handling of kernel signals
ENTRYPOINT ["tini", "--", "./docker-entrypoint.sh"]
