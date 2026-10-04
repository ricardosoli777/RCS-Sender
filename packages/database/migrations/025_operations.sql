CREATE TABLE worker_heartbeats (
  instance_id uuid PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK(status IN ('healthy','degraded','stopped'))
);
CREATE TABLE event_consumer_failures (
  workspace_id uuid NOT NULL,
  event_id uuid NOT NULL,
  consumer text NOT NULL CHECK(consumer IN ('campaigns','journeys','scoring','analytics','conversations','audit')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  generation integer NOT NULL DEFAULT 0 CHECK(generation>=0),
  available_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,event_id,consumer),
  FOREIGN KEY(workspace_id,event_id) REFERENCES canonical_events(workspace_id,id)
);
CREATE INDEX event_consumer_failures_due ON event_consumer_failures(available_at) WHERE attempts<5;
