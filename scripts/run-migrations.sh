#!/bin/sh
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

psql --set=ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS _application_migrations (
  migration_name TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
SQL

found_migration=false
for migration in /migrations/*.sql; do
  if [ ! -f "$migration" ]; then
    continue
  fi
  found_migration=true

  name=${migration##*/}
  case "$name" in
    [0-9][0-9][0-9][0-9]_[a-z0-9_]*.sql) ;;
    *)
      echo "Migration filename must start with four digits and an underscore: $name" >&2
      exit 1
      ;;
  esac
  case "$name" in
    *[!a-z0-9_.-]*)
      echo "Migration filename contains unsupported characters: $name" >&2
      exit 1
      ;;
  esac

  checksum=$(sha256sum "$migration" | cut -d ' ' -f 1)
  applied_checksum=$(psql --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command="SELECT checksum FROM _application_migrations WHERE migration_name = '$name'")

  if [ -n "$applied_checksum" ]; then
    if [ "$applied_checksum" != "$checksum" ]; then
      echo "Applied migration was changed: $name" >&2
      exit 1
    fi
    echo "Already applied: $name"
    continue
  fi

  echo "Applying: $name"
  {
    printf 'BEGIN;\n'
    cat "$migration"
    printf "\nINSERT INTO _application_migrations (migration_name, checksum) VALUES ('%s', '%s');\n" "$name" "$checksum"
    printf 'COMMIT;\n'
  } | psql --set=ON_ERROR_STOP=1
done

if [ "$found_migration" = false ]; then
  echo "No application migrations found; no business schema was created."
fi
