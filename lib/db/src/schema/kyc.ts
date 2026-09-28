import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const kycTable = pgTable("kyc", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  level: integer("level").notNull().default(0),
  status: text("status").notNull().default("pending"), // pending, submitted, verified, rejected
  documentType: text("document_type"),
  documentNumber: text("document_number"),
  bvn: text("bvn"),
  nin: text("nin"),
  rejectionReason: text("rejection_reason"),
  documentFrontUrl: text("document_front_url"),
  documentBackUrl: text("document_back_url"),
  selfieUrl: text("selfie_url"),
  fullName: text("full_name"),
  dateOfBirth: text("date_of_birth"),
  address: text("address"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  reviewedBy: integer("reviewed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertKycSchema = createInsertSchema(kycTable).omit({ id: true, createdAt: true });
export type InsertKyc = z.infer<typeof insertKycSchema>;
export type Kyc = typeof kycTable.$inferSelect;
