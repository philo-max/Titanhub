CREATE TYPE "public"."media_type" AS ENUM('anime', 'manga', 'novel', 'movie');--> statement-breakpoint
CREATE TYPE "public"."tracking_status" AS ENUM('watching', 'completed', 'plan_to', 'dropped');--> statement-breakpoint
CREATE TABLE "danmaku" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "danmaku_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"media_id" varchar(255) NOT NULL,
	"plugin_id" varchar(255) NOT NULL,
	"episode" varchar(64) NOT NULL,
	"time_offset" real NOT NULL,
	"content" text NOT NULL,
	"color" varchar(7) DEFAULT '#FFFFFF' NOT NULL,
	"user_hash" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"media_type" "media_type" NOT NULL,
	"media_id" varchar(255) NOT NULL,
	"plugin_id" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"version" varchar(16),
	"types" varchar(255),
	"author" varchar(128),
	"code" text NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"install_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plugins_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
CREATE TABLE "tracking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"media_type" "media_type" NOT NULL,
	"media_id" varchar(255) NOT NULL,
	"plugin_id" varchar(255) NOT NULL,
	"chapter_no" integer DEFAULT 0 NOT NULL,
	"chapter_id" varchar(255),
	"progress" double precision DEFAULT 0 NOT NULL,
	"status" "tracking_status" DEFAULT 'watching' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(32) NOT NULL,
	"password" varchar(255),
	"avatar_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking" ADD CONSTRAINT "tracking_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;