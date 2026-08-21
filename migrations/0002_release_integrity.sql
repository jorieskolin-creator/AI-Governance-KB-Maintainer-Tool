CREATE UNIQUE INDEX IF NOT EXISTS uq_releases_domain_run_version
  ON releases(domain_run_id, release_version);

CREATE UNIQUE INDEX IF NOT EXISTS uq_artifacts_storage_uri
  ON artifacts(storage_uri);

CREATE UNIQUE INDEX IF NOT EXISTS uq_artifacts_release_type_object_version
  ON artifacts(
    release_id,
    artifact_type,
    COALESCE(object_id, ''),
    COALESCE(version, '')
  );
