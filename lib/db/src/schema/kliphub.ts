import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const kliphubProjectsTable = pgTable("kliphub_projects", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  prompt: text("prompt"),
  status: text("status").notNull().default("draft"),
  durationSec: integer("duration_sec").notNull().default(30),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const kliphubScenesTable = pgTable("kliphub_scenes", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => kliphubProjectsTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  durationSec: integer("duration_sec").notNull().default(5),
  videoUrl: text("video_url"),
  status: text("status").notNull().default("queued"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kliphubJobsTable = pgTable("kliphub_jobs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => kliphubProjectsTable.id, { onDelete: "cascade" }),
  sceneId: integer("scene_id").references(() => kliphubScenesTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider"),
  status: text("status").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  inputJson: text("input_json"),
  outputJson: text("output_json"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const kliphubCreditsTable = pgTable("kliphub_credits", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  reason: text("reason").notNull(),
  jobId: integer("job_id").references(() => kliphubJobsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kliphubChannelsTable = pgTable("kliphub_channels", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  name: text("name").notNull(),
  handle: text("handle"),
  status: text("status").notNull().default("connected"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kliphubSchedulesTable = pgTable("kliphub_schedules", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => kliphubProjectsTable.id, { onDelete: "cascade" }),
  channelId: integer("channel_id").references(() => kliphubChannelsTable.id, { onDelete: "cascade" }),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("scheduled"),
});

export const kliphubAssetsTable = pgTable("kliphub_assets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => kliphubProjectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  url: text("url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertKlipHubProjectSchema = createInsertSchema(kliphubProjectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKlipHubProject = z.infer<typeof insertKlipHubProjectSchema>;
export type KlipHubProject = typeof kliphubProjectsTable.$inferSelect;
