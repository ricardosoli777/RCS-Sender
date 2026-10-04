CREATE TABLE journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100 AND name !~ '^\s*$'),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','active','paused','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  draft_graph jsonb NOT NULL,
  published_version integer,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id)
);
CREATE TABLE journey_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  journey_id uuid NOT NULL,
  version integer NOT NULL CHECK(version>0),
  graph jsonb NOT NULL,
  published_by_user_id uuid NOT NULL REFERENCES users(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,id,journey_id),
  UNIQUE(workspace_id,journey_id,version),
  FOREIGN KEY(workspace_id,journey_id) REFERENCES journeys(workspace_id,id)
);
ALTER TABLE journeys ADD CONSTRAINT journey_published_version_fk FOREIGN KEY(workspace_id,id,published_version) REFERENCES journey_versions(workspace_id,journey_id,version);
CREATE TABLE journey_nodes (
  workspace_id uuid NOT NULL,
  version_id uuid NOT NULL,
  node_id text NOT NULL,
  node_type text NOT NULL CHECK(node_type IN ('start','message','wait','condition','branch','tag','score','webhook','goal','end')),
  config jsonb NOT NULL,
  position jsonb NOT NULL,
  message_version_id uuid,
  connection_id uuid,
  PRIMARY KEY(workspace_id,version_id,node_id),
  FOREIGN KEY(workspace_id,version_id) REFERENCES journey_versions(workspace_id,id),
  FOREIGN KEY(workspace_id,message_version_id) REFERENCES message_versions(workspace_id,id),
  FOREIGN KEY(workspace_id,connection_id) REFERENCES provider_connections(workspace_id,id),
  CHECK((node_type='message' AND message_version_id IS NOT NULL AND connection_id IS NOT NULL) OR (node_type<>'message' AND message_version_id IS NULL AND connection_id IS NULL))
);
CREATE TABLE journey_edges (
  workspace_id uuid NOT NULL,
  version_id uuid NOT NULL,
  edge_id text NOT NULL,
  source_node_id text NOT NULL,
  target_node_id text NOT NULL,
  port text NOT NULL,
  PRIMARY KEY(workspace_id,version_id,edge_id),
  UNIQUE(workspace_id,version_id,source_node_id,port),
  FOREIGN KEY(workspace_id,version_id,source_node_id) REFERENCES journey_nodes(workspace_id,version_id,node_id),
  FOREIGN KEY(workspace_id,version_id,target_node_id) REFERENCES journey_nodes(workspace_id,version_id,node_id)
);
CREATE FUNCTION protect_journey_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'published journey version is immutable'; END $$;
CREATE TRIGGER journey_versions_immutable BEFORE UPDATE OR DELETE ON journey_versions FOR EACH ROW EXECUTE FUNCTION protect_journey_version();
CREATE TRIGGER journey_nodes_immutable BEFORE UPDATE OR DELETE ON journey_nodes FOR EACH ROW EXECUTE FUNCTION protect_journey_version();
CREATE TRIGGER journey_edges_immutable BEFORE UPDATE OR DELETE ON journey_edges FOR EACH ROW EXECUTE FUNCTION protect_journey_version();
