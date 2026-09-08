CREATE SCHEMA "reference";
--> statement-breakpoint
CREATE TABLE "reference"."location_aliases" (
	"node_id" text NOT NULL,
	"alias_normalised" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_aliases_node_id_alias_normalised_pk" PRIMARY KEY("node_id","alias_normalised")
);
--> statement-breakpoint
CREATE TABLE "reference"."location_dataset_versions" (
	"version" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"notes" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference"."location_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"kind" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"name_normalised" text NOT NULL,
	"dataset_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_nodes_level_check" CHECK (level IN ('district', 'city', 'town', 'locality')),
	CONSTRAINT "location_nodes_kind_check" CHECK (kind IN ('district', 'taluk', 'corporation', 'municipality', 'grama_panchayat', 'zone')),
	CONSTRAINT "location_nodes_root_check" CHECK ((level = 'district') = (parent_id IS NULL))
);
--> statement-breakpoint
ALTER TABLE "reference"."location_aliases" ADD CONSTRAINT "location_aliases_node_id_location_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "reference"."location_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference"."location_nodes" ADD CONSTRAINT "location_nodes_dataset_version_location_dataset_versions_version_fk" FOREIGN KEY ("dataset_version") REFERENCES "reference"."location_dataset_versions"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference"."location_nodes" ADD CONSTRAINT "location_nodes_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "reference"."location_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "location_aliases_alias_node_idx" ON "reference"."location_aliases" USING btree ("alias_normalised","node_id");--> statement-breakpoint
CREATE INDEX "location_nodes_parent_name_idx" ON "reference"."location_nodes" USING btree ("parent_id","name_normalised");--> statement-breakpoint
CREATE INDEX "location_nodes_level_idx" ON "reference"."location_nodes" USING btree ("level");