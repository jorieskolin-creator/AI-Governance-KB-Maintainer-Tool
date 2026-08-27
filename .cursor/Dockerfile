FROM node:22-bookworm-slim

# System toolchain for the service:
# - postgresql: local control-plane database used by the app and migrations
# - git/curl/ca-certificates: repository checkout and outbound tooling
# - build-essential/python3: native module builds for npm dependencies (e.g. pg)
# - sudo: convenience for interactive agent sessions
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        postgresql \
        postgresql-contrib \
        git \
        curl \
        ca-certificates \
        build-essential \
        python3 \
        sudo \
    && rm -rf /var/lib/apt/lists/*

# Expose the versioned PostgreSQL client/server binaries on PATH.
RUN for f in /usr/lib/postgresql/*/bin/*; do ln -sf "$f" /usr/local/bin/; done

# Passwordless sudo for the default non-root user used by the agent.
RUN echo 'node ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/node \
    && chmod 0440 /etc/sudoers.d/node

# Local development database connection consumed by the app and migrations.
ENV DATABASE_URL=postgres://postgres@localhost:5432/kb_maintainer \
    PGDATA=/home/node/.pgdata \
    PORT=3000

USER node
