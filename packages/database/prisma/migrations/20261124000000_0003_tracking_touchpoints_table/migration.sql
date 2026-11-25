-- T08: Replace JSON blob systemSetting('tracking_touchpoints_v1') with durable table tracking_touchpoints
CREATE TABLE IF NOT EXISTS "tracking_touchpoints" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "source_website" TEXT NOT NULL,
    "page_url" TEXT,
    "lead_code" TEXT,
    "submission_id" TEXT,
    "visitor_id" TEXT,
    "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "tracking_touchpoints_event_id_key" ON "tracking_touchpoints"("event_id");
CREATE INDEX IF NOT EXISTS "tracking_touchpoints_source_website_occurred_at_idx" ON "tracking_touchpoints"("source_website", "occurred_at");
CREATE INDEX IF NOT EXISTS "tracking_touchpoints_occurred_at_idx" ON "tracking_touchpoints"("occurred_at");
CREATE INDEX IF NOT EXISTS "tracking_touchpoints_submission_id_idx" ON "tracking_touchpoints"("submission_id");
