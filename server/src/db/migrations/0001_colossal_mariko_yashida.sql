CREATE TABLE "media_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_type" "media_type" NOT NULL,
	"media_id" varchar(255) NOT NULL,
	"plugin_id" varchar(255) NOT NULL,
	"title" varchar(512) NOT NULL,
	"cover" text,
	"views" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_media_views_unique" UNIQUE("plugin_id","media_id","media_type")
);
