import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Simple key/value store for admin-editable runtime configuration (e.g. the
// company deposit account users transfer to). One row per setting key, value is
// JSON-encoded text so each setting can hold an arbitrary shape.
export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppSetting = typeof appSettingsTable.$inferSelect;
