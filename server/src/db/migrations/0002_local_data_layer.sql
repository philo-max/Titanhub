CREATE TABLE "history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"media_type" "media_type" NOT NULL,
	"media_id" varchar(255) NOT NULL,
	"plugin_id" varchar(255) NOT NULL,
	"chapter_id" varchar(255) DEFAULT '' NOT NULL,
	"chapter_no" integer DEFAULT 0 NOT NULL,
	"title" varchar(512),
	"cover" text,
	"progress" double precision DEFAULT 0.0 NOT NULL,
	"watched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_media_chapter_history_unique" UNIQUE("user_id","media_id","chapter_id")
);
--> statement-breakpoint
ALTER TABLE "history" ADD CONSTRAINT "history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
