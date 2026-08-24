FROM ghcr.io/cloudnative-pg/postgresql@sha256:b1deeed2aa998b2f381e39c5cadb9ec06127708c8bd62965743af19abf21628f

USER root

ADD --checksum=sha256:2401dbae2bbb1dd4f0cc4196ae26ff23b3d852c63d31604e59f1b81dce8140c9 \
  https://apt.postgresql.org/pub/repos/apt/pool/main/p/pg-cron/postgresql-17-cron_1.6.7-3.pgdg11+1_amd64.deb \
  /tmp/postgresql-17-cron.deb

RUN dpkg --install /tmp/postgresql-17-cron.deb \
  && rm /tmp/postgresql-17-cron.deb \
  && test -f /usr/share/postgresql/17/extension/pg_cron.control \
  && test -f /usr/lib/postgresql/17/lib/pg_cron.so

USER 26
