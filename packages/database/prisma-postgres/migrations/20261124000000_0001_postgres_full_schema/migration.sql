-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "category_group" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'm2',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" SERIAL NOT NULL,
    "lead_code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "company_name" TEXT,
    "project_name" TEXT,
    "normalized_lookup_key" TEXT,
    "contact_name" TEXT,
    "phone" TEXT NOT NULL,
    "is_phone_unstandardized" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "contact_channel" TEXT NOT NULL,
    "source_website" TEXT,
    "self_reported_source" TEXT,
    "area_type" TEXT,
    "province" TEXT,
    "district" TEXT,
    "installation_address" TEXT,
    "pipeline_status" TEXT NOT NULL DEFAULT 'new_lead',
    "lost_reason" TEXT,
    "currency_code" TEXT NOT NULL DEFAULT 'VND',
    "quote_value" BIGINT,
    "deal_value" BIGINT,
    "assigned_sales_id" INTEGER,
    "created_by_user_id" INTEGER,
    "created_by_actor_type" TEXT NOT NULL DEFAULT 'user',
    "created_by_actor_ref" TEXT,
    "received_by_user_id" INTEGER,
    "is_duplicate_alert" BOOLEAN NOT NULL DEFAULT false,
    "duplicate_status" TEXT NOT NULL DEFAULT 'none',
    "matched_old_lead_id" INTEGER,
    "is_suspected_price_check" BOOLEAN NOT NULL DEFAULT false,
    "is_spam" BOOLEAN NOT NULL DEFAULT false,
    "spam_reason" TEXT,
    "spam_ads_exclusion_status" TEXT NOT NULL DEFAULT 'none',
    "auto_reassign_count" INTEGER NOT NULL DEFAULT 0,
    "needs_manager_attention" BOOLEAN NOT NULL DEFAULT false,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "contacted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at" TIMESTAMP(3),
    "first_quote_sent_at" TIMESTAMP(3),
    "quote_responded_at" TIMESTAMP(3),
    "last_quote_reminder_at" TIMESTAMP(3),
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_products" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "custom_product_name" TEXT,
    "requested_dimension" TEXT,
    "note_specification" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_attachments" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "attachment_type" TEXT NOT NULL,
    "folder_path" TEXT,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_size_kb" INTEGER NOT NULL,
    "uploaded_by" INTEGER NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "action_type" TEXT NOT NULL,
    "from_sales_id" INTEGER,
    "to_sales_id" INTEGER,
    "transfer_reason" TEXT,
    "old_status" TEXT,
    "new_status" TEXT,
    "old_value_json" TEXT,
    "new_value_json" TEXT,
    "note" TEXT,
    "action_by" INTEGER,
    "actor_type" TEXT NOT NULL DEFAULT 'user',
    "actor_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_check_alerts" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "company_name" TEXT,
    "normalized_lookup_key" TEXT,
    "reason" TEXT NOT NULL,
    "chat_screenshot_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "previous_alert_id" INTEGER,
    "created_by_user_id" INTEGER NOT NULL,
    "removed_by_user_id" INTEGER,
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_check_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" SERIAL NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'google_ads',
    "account_external_id" TEXT NOT NULL DEFAULT 'default',
    "campaign_code" TEXT NOT NULL,
    "campaign_name" TEXT NOT NULL,
    "utm_campaign_slug" TEXT,
    "currency_code" TEXT NOT NULL DEFAULT 'VND',
    "daily_budget_micros" BIGINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_tracking" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "campaign_id" INTEGER,
    "intake_channel" TEXT NOT NULL DEFAULT 'form_web',
    "intake_source_provider" TEXT NOT NULL DEFAULT 'manual',
    "intake_source_account_key" TEXT NOT NULL DEFAULT 'internal',
    "external_submission_id" TEXT,
    "marketing_source" TEXT NOT NULL DEFAULT 'Chưa xác định',
    "source_resolution_method" TEXT NOT NULL DEFAULT 'unknown',
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "campaign_name" TEXT,
    "gclid" TEXT,
    "referrer_url" TEXT,
    "landing_page_url" TEXT,
    "device_type" TEXT,
    "ip_address" TEXT,
    "geo_location" TEXT,
    "is_unknown_source" BOOLEAN NOT NULL DEFAULT false,
    "is_unknown_campaign" BOOLEAN NOT NULL DEFAULT false,
    "is_utm_gclid_mismatch" BOOLEAN NOT NULL DEFAULT false,
    "is_unmatched_utm" BOOLEAN NOT NULL DEFAULT false,
    "is_repeat_lead" BOOLEAN NOT NULL DEFAULT false,
    "gclid_retry_count" INTEGER NOT NULL DEFAULT 0,
    "gclid_last_tried_at" TIMESTAMP(3),
    "sync_ga4_status" TEXT NOT NULL DEFAULT 'pending',
    "tracked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_daily_metrics" (
    "id" SERIAL NOT NULL,
    "platform" TEXT NOT NULL,
    "account_property_id" TEXT NOT NULL,
    "metric_date" TEXT NOT NULL,
    "grain" TEXT NOT NULL,
    "campaign_external_id" TEXT NOT NULL DEFAULT '',
    "keyword_match_type" TEXT NOT NULL DEFAULT '',
    "keyword_text_norm" TEXT NOT NULL DEFAULT '',
    "page_path_norm" TEXT NOT NULL DEFAULT '',
    "dimension_fingerprint" TEXT NOT NULL,
    "campaign_id" INTEGER,
    "campaign_name" TEXT,
    "keyword" TEXT,
    "page_url" TEXT,
    "currency_code" TEXT NOT NULL DEFAULT 'VND',
    "spend_micros" BIGINT NOT NULL DEFAULT 0,
    "daily_budget_micros" BIGINT,
    "cpc_micros" BIGINT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions_micros" BIGINT NOT NULL DEFAULT 0,
    "google_lead_form_count" INTEGER NOT NULL DEFAULT 0,
    "page_views" INTEGER NOT NULL DEFAULT 0,
    "avg_time_on_page_sec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_position" DOUBLE PRECISION,
    "fanpage_engagements" INTEGER NOT NULL DEFAULT 0,
    "trend_interest_score" INTEGER,
    "is_finalized" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_sync_logs" (
    "id" SERIAL NOT NULL,
    "platform" TEXT NOT NULL,
    "account_property_id" TEXT NOT NULL DEFAULT 'default',
    "run_type" TEXT NOT NULL DEFAULT 'full',
    "window_start_date" TEXT,
    "window_end_date" TEXT,
    "records_synced" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'success',
    "error_message" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "platform_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_reconciliations" (
    "id" SERIAL NOT NULL,
    "reconcile_date" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'google_ads',
    "account_property_id" TEXT NOT NULL DEFAULT 'default',
    "crm_lead_count" INTEGER NOT NULL DEFAULT 0,
    "crm_error_log_count" INTEGER NOT NULL DEFAULT 0,
    "platform_reported_count" INTEGER NOT NULL DEFAULT 0,
    "discrepancy" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "resolved_by_user_id" INTEGER,
    "resolution_note" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_intake_error_logs" (
    "id" SERIAL NOT NULL,
    "source_platform" TEXT NOT NULL,
    "intake_source_account_key" TEXT NOT NULL DEFAULT 'unknown',
    "external_submission_id" TEXT,
    "raw_payload_json" TEXT NOT NULL,
    "error_code" TEXT NOT NULL,
    "error_message" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_retried_at" TIMESTAMP(3),
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_lead_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_intake_error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_touchpoints" (
    "id" SERIAL NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "source_website" TEXT NOT NULL,
    "page_url" TEXT,
    "lead_code" TEXT,
    "submission_id" TEXT,
    "visitor_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_touchpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_keywords" (
    "id" SERIAL NOT NULL,
    "keyword" TEXT NOT NULL,
    "keyword_norm" TEXT NOT NULL,
    "cached_search_volume" INTEGER,
    "cached_ads_clicks" INTEGER,
    "cached_organic_clicks" INTEGER,
    "cached_avg_position" DOUBLE PRECISION,
    "cache_source_account_key" TEXT,
    "cache_window_start_date" TEXT,
    "cache_window_end_date" TEXT,
    "cache_refreshed_at" TIMESTAMP(3),
    "trend_direction" TEXT NOT NULL DEFAULT 'stable',
    "recommended_publish_window" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_articles" (
    "id" SERIAL NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "keyword_id" INTEGER,
    "topic" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT,
    "meta_description" TEXT,
    "ai_suggested_outline" TEXT,
    "content_html" TEXT NOT NULL,
    "target_website" TEXT NOT NULL DEFAULT 'toantrung.com.vn',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "current_revision_id" INTEGER,
    "approved_revision_id" INTEGER,
    "scheduled_publish_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "published_url" TEXT,
    "publish_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_publish_error" TEXT,
    "cached_organic_clicks" INTEGER,
    "cached_avg_position" DOUBLE PRECISION,
    "cached_avg_time_on_page_sec" DOUBLE PRECISION,
    "metrics_refreshed_at" TIMESTAMP(3),
    "needs_optimization" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" INTEGER NOT NULL,
    "approved_by_user_id" INTEGER,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_article_revisions" (
    "id" SERIAL NOT NULL,
    "article_id" INTEGER NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "origin_type" TEXT NOT NULL DEFAULT 'human_edit',
    "title" TEXT NOT NULL,
    "meta_description" TEXT,
    "content_html" TEXT NOT NULL,
    "change_note" TEXT,
    "edited_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seo_article_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_requests" (
    "id" SERIAL NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lead_id" INTEGER,
    "requested_by_sales_id" INTEGER,
    "assigned_designer_id" INTEGER NOT NULL,
    "request_type" TEXT NOT NULL,
    "led_category" TEXT,
    "screen_dimensions" TEXT,
    "aspect_ratio" TEXT,
    "install_position_json" TEXT,
    "site_photo_url" TEXT,
    "prompt" TEXT,
    "design_status" TEXT NOT NULL DEFAULT 'pending',
    "ai_draft_image_url" TEXT,
    "final_render_url" TEXT,
    "approved_version_id" INTEGER,
    "processing_time_ms" INTEGER,
    "token_cost" INTEGER,
    "total_cost_micros" BIGINT,
    "cost_currency" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "design_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_asset_versions" (
    "id" SERIAL NOT NULL,
    "design_request_id" INTEGER NOT NULL,
    "version_number" INTEGER NOT NULL,
    "version_type" TEXT NOT NULL,
    "storage_object_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL DEFAULT 'image/png',
    "file_size_bytes" INTEGER,
    "prompt_used" TEXT,
    "parameters_json" TEXT,
    "ai_usage_log_id" INTEGER,
    "uploaded_by_user_id" INTEGER NOT NULL,
    "is_approved_final" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_asset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "role_code" TEXT NOT NULL,
    "role_name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "role_id" INTEGER NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT 'sales',
    "specialty_group" TEXT,
    "is_receiving_leads" BOOLEAN NOT NULL DEFAULT true,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "avatar_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "csrf_token" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Hệ thống',
    "action_label" TEXT,
    "action_url" TEXT,
    "required_permission" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branding_assets" (
    "id" SERIAL NOT NULL,
    "slot" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "alt_text" TEXT NOT NULL,
    "cover_position" TEXT NOT NULL DEFAULT 'center',
    "crop_json" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "uploaded_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branding_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by_id" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "actor_user_id" INTEGER,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "details_json" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" SERIAL NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "provider_request_id" TEXT,
    "module_code" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "design_request_id" INTEGER,
    "seo_article_id" INTEGER,
    "model_name" TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "total_tokens" INTEGER,
    "cost_micros" BIGINT,
    "cost_currency" TEXT,
    "duration_ms" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'success',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_product_code_key" ON "products"("product_code");

-- CreateIndex
CREATE INDEX "products_category_group_is_active_idx" ON "products"("category_group", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "leads_lead_code_key" ON "leads"("lead_code");

-- CreateIndex
CREATE INDEX "leads_phone_idx" ON "leads"("phone");

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");

-- CreateIndex
CREATE INDEX "leads_normalized_lookup_key_idx" ON "leads"("normalized_lookup_key");

-- CreateIndex
CREATE INDEX "leads_pipeline_status_is_spam_idx" ON "leads"("pipeline_status", "is_spam");

-- CreateIndex
CREATE INDEX "leads_is_spam_spam_ads_exclusion_status_idx" ON "leads"("is_spam", "spam_ads_exclusion_status");

-- CreateIndex
CREATE INDEX "leads_assigned_sales_id_pipeline_status_idx" ON "leads"("assigned_sales_id", "pipeline_status");

-- CreateIndex
CREATE INDEX "leads_created_at_idx" ON "leads"("created_at");

-- CreateIndex
CREATE INDEX "lead_products_lead_id_idx" ON "lead_products"("lead_id");

-- CreateIndex
CREATE INDEX "lead_products_product_id_idx" ON "lead_products"("product_id");

-- CreateIndex
CREATE INDEX "lead_attachments_lead_id_attachment_type_idx" ON "lead_attachments"("lead_id", "attachment_type");

-- CreateIndex
CREATE INDEX "lead_activities_lead_id_created_at_idx" ON "lead_activities"("lead_id", "created_at");

-- CreateIndex
CREATE INDEX "lead_activities_action_by_idx" ON "lead_activities"("action_by");

-- CreateIndex
CREATE INDEX "price_check_alerts_phone_status_idx" ON "price_check_alerts"("phone", "status");

-- CreateIndex
CREATE INDEX "price_check_alerts_normalized_lookup_key_status_idx" ON "price_check_alerts"("normalized_lookup_key", "status");

-- CreateIndex
CREATE INDEX "price_check_alerts_lead_id_idx" ON "price_check_alerts"("lead_id");

-- CreateIndex
CREATE INDEX "campaigns_utm_campaign_slug_idx" ON "campaigns"("utm_campaign_slug");

-- CreateIndex
CREATE INDEX "campaigns_platform_is_active_idx" ON "campaigns"("platform", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_platform_account_external_id_campaign_code_key" ON "campaigns"("platform", "account_external_id", "campaign_code");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_tracking_lead_id_key" ON "marketing_tracking"("lead_id");

-- CreateIndex
CREATE INDEX "marketing_tracking_marketing_source_idx" ON "marketing_tracking"("marketing_source");

-- CreateIndex
CREATE INDEX "marketing_tracking_campaign_id_idx" ON "marketing_tracking"("campaign_id");

-- CreateIndex
CREATE INDEX "marketing_tracking_gclid_idx" ON "marketing_tracking"("gclid");

-- CreateIndex
CREATE INDEX "marketing_tracking_is_unknown_campaign_tracked_at_idx" ON "marketing_tracking"("is_unknown_campaign", "tracked_at");

-- CreateIndex
CREATE INDEX "marketing_tracking_tracked_at_idx" ON "marketing_tracking"("tracked_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_tracking_intake_source_provider_intake_source_acc_key" ON "marketing_tracking"("intake_source_provider", "intake_source_account_key", "external_submission_id");

-- CreateIndex
CREATE INDEX "platform_daily_metrics_platform_metric_date_grain_idx" ON "platform_daily_metrics"("platform", "metric_date", "grain");

-- CreateIndex
CREATE INDEX "platform_daily_metrics_platform_grain_metric_date_idx" ON "platform_daily_metrics"("platform", "grain", "metric_date");

-- CreateIndex
CREATE INDEX "platform_daily_metrics_campaign_id_metric_date_idx" ON "platform_daily_metrics"("campaign_id", "metric_date");

-- CreateIndex
CREATE INDEX "platform_daily_metrics_campaign_id_grain_idx" ON "platform_daily_metrics"("campaign_id", "grain");

-- CreateIndex
CREATE INDEX "platform_daily_metrics_keyword_text_norm_metric_date_idx" ON "platform_daily_metrics"("keyword_text_norm", "metric_date");

-- CreateIndex
CREATE UNIQUE INDEX "platform_daily_metrics_platform_account_property_id_metric__key" ON "platform_daily_metrics"("platform", "account_property_id", "metric_date", "grain", "campaign_external_id", "keyword_match_type", "keyword_text_norm", "page_path_norm");

-- CreateIndex
CREATE INDEX "platform_sync_logs_platform_account_property_id_started_at_idx" ON "platform_sync_logs"("platform", "account_property_id", "started_at");

-- CreateIndex
CREATE INDEX "lead_reconciliations_status_idx" ON "lead_reconciliations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "lead_reconciliations_reconcile_date_platform_account_proper_key" ON "lead_reconciliations"("reconcile_date", "platform", "account_property_id");

-- CreateIndex
CREATE INDEX "webhook_intake_error_logs_source_platform_created_at_idx" ON "webhook_intake_error_logs"("source_platform", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_intake_error_logs_source_platform_intake_source_acc_key" ON "webhook_intake_error_logs"("source_platform", "intake_source_account_key", "external_submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_touchpoints_event_id_key" ON "tracking_touchpoints"("event_id");

-- CreateIndex
CREATE INDEX "tracking_touchpoints_source_website_occurred_at_idx" ON "tracking_touchpoints"("source_website", "occurred_at");

-- CreateIndex
CREATE INDEX "tracking_touchpoints_occurred_at_idx" ON "tracking_touchpoints"("occurred_at");

-- CreateIndex
CREATE INDEX "tracking_touchpoints_submission_id_idx" ON "tracking_touchpoints"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "seo_keywords_keyword_key" ON "seo_keywords"("keyword");

-- CreateIndex
CREATE UNIQUE INDEX "seo_keywords_keyword_norm_key" ON "seo_keywords"("keyword_norm");

-- CreateIndex
CREATE INDEX "seo_keywords_trend_direction_idx" ON "seo_keywords"("trend_direction");

-- CreateIndex
CREATE UNIQUE INDEX "seo_articles_current_revision_id_key" ON "seo_articles"("current_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "seo_articles_approved_revision_id_key" ON "seo_articles"("approved_revision_id");

-- CreateIndex
CREATE INDEX "seo_articles_status_scheduled_publish_at_idx" ON "seo_articles"("status", "scheduled_publish_at");

-- CreateIndex
CREATE INDEX "seo_articles_target_website_status_idx" ON "seo_articles"("target_website", "status");

-- CreateIndex
CREATE INDEX "seo_articles_keyword_id_idx" ON "seo_articles"("keyword_id");

-- CreateIndex
CREATE UNIQUE INDEX "seo_articles_target_website_slug_key" ON "seo_articles"("target_website", "slug");

-- CreateIndex
CREATE INDEX "seo_article_revisions_article_id_created_at_idx" ON "seo_article_revisions"("article_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "seo_article_revisions_article_id_revision_number_key" ON "seo_article_revisions"("article_id", "revision_number");

-- CreateIndex
CREATE UNIQUE INDEX "design_requests_approved_version_id_key" ON "design_requests"("approved_version_id");

-- CreateIndex
CREATE INDEX "design_requests_lead_id_idx" ON "design_requests"("lead_id");

-- CreateIndex
CREATE INDEX "design_requests_assigned_designer_id_idx" ON "design_requests"("assigned_designer_id");

-- CreateIndex
CREATE INDEX "design_requests_requested_by_sales_id_idx" ON "design_requests"("requested_by_sales_id");

-- CreateIndex
CREATE INDEX "design_requests_assigned_designer_id_design_status_idx" ON "design_requests"("assigned_designer_id", "design_status");

-- CreateIndex
CREATE INDEX "design_requests_request_type_design_status_idx" ON "design_requests"("request_type", "design_status");

-- CreateIndex
CREATE UNIQUE INDEX "design_asset_versions_ai_usage_log_id_key" ON "design_asset_versions"("ai_usage_log_id");

-- CreateIndex
CREATE INDEX "design_asset_versions_design_request_id_version_type_idx" ON "design_asset_versions"("design_request_id", "version_type");

-- CreateIndex
CREATE UNIQUE INDEX "design_asset_versions_design_request_id_version_number_key" ON "design_asset_versions"("design_request_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "roles_role_code_key" ON "roles"("role_code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_id_idx" ON "users"("role_id");

-- CreateIndex
CREATE INDEX "users_department_is_active_is_receiving_leads_idx" ON "users"("department", "is_active", "is_receiving_leads");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE UNIQUE INDEX "branding_assets_object_key_key" ON "branding_assets"("object_key");

-- CreateIndex
CREATE INDEX "branding_assets_slot_is_active_idx" ON "branding_assets"("slot", "is_active");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_logs_idempotency_key_key" ON "ai_usage_logs"("idempotency_key");

-- CreateIndex
CREATE INDEX "ai_usage_logs_module_code_created_at_idx" ON "ai_usage_logs"("module_code", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_user_id_created_at_idx" ON "ai_usage_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_design_request_id_idx" ON "ai_usage_logs"("design_request_id");

-- CreateIndex
CREATE INDEX "ai_usage_logs_seo_article_id_idx" ON "ai_usage_logs"("seo_article_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_sales_id_fkey" FOREIGN KEY ("assigned_sales_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_matched_old_lead_id_fkey" FOREIGN KEY ("matched_old_lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_products" ADD CONSTRAINT "lead_products_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_products" ADD CONSTRAINT "lead_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_attachments" ADD CONSTRAINT "lead_attachments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_attachments" ADD CONSTRAINT "lead_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_action_by_fkey" FOREIGN KEY ("action_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_from_sales_id_fkey" FOREIGN KEY ("from_sales_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_to_sales_id_fkey" FOREIGN KEY ("to_sales_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_check_alerts" ADD CONSTRAINT "price_check_alerts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_check_alerts" ADD CONSTRAINT "price_check_alerts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_check_alerts" ADD CONSTRAINT "price_check_alerts_removed_by_user_id_fkey" FOREIGN KEY ("removed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_tracking" ADD CONSTRAINT "marketing_tracking_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_tracking" ADD CONSTRAINT "marketing_tracking_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_daily_metrics" ADD CONSTRAINT "platform_daily_metrics_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_reconciliations" ADD CONSTRAINT "lead_reconciliations_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_articles" ADD CONSTRAINT "seo_articles_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "seo_keywords"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_articles" ADD CONSTRAINT "seo_articles_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_articles" ADD CONSTRAINT "seo_articles_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_articles" ADD CONSTRAINT "seo_articles_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "seo_article_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_articles" ADD CONSTRAINT "seo_articles_approved_revision_id_fkey" FOREIGN KEY ("approved_revision_id") REFERENCES "seo_article_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_article_revisions" ADD CONSTRAINT "seo_article_revisions_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "seo_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_article_revisions" ADD CONSTRAINT "seo_article_revisions_edited_by_user_id_fkey" FOREIGN KEY ("edited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_requests" ADD CONSTRAINT "design_requests_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_requests" ADD CONSTRAINT "design_requests_requested_by_sales_id_fkey" FOREIGN KEY ("requested_by_sales_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_requests" ADD CONSTRAINT "design_requests_assigned_designer_id_fkey" FOREIGN KEY ("assigned_designer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_requests" ADD CONSTRAINT "design_requests_approved_version_id_fkey" FOREIGN KEY ("approved_version_id") REFERENCES "design_asset_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_asset_versions" ADD CONSTRAINT "design_asset_versions_design_request_id_fkey" FOREIGN KEY ("design_request_id") REFERENCES "design_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_asset_versions" ADD CONSTRAINT "design_asset_versions_ai_usage_log_id_fkey" FOREIGN KEY ("ai_usage_log_id") REFERENCES "ai_usage_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_asset_versions" ADD CONSTRAINT "design_asset_versions_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branding_assets" ADD CONSTRAINT "branding_assets_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_design_request_id_fkey" FOREIGN KEY ("design_request_id") REFERENCES "design_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_seo_article_id_fkey" FOREIGN KEY ("seo_article_id") REFERENCES "seo_articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

